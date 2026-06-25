import { getAllAliases, type ExtractedFields } from "../core/schema-extractor.js";
import { buildParserOptions } from "./argv-parser.js";

/**
 * Pre-computed lookup tables for recognizing global flags in argv scanning.
 */
export interface GlobalFlagLookup {
  aliasMap: Map<string, string>;
  booleanFlags: Set<string>;
  /** camelCase field names */
  flagNames: Set<string>;
  /** kebab-case CLI names */
  cliNames: Set<string>;
  /** single-char (short) aliases */
  aliases: Set<string>;
  /** custom negation names mapped to their target field name */
  negationMap: Map<string, string>;
  /** fields whose default `--no-*` negation is disabled */
  defaultNegationDisabledFields: Set<string>;
}

/**
 * Build lookup tables from extracted global schema fields.
 * Shared by scanForSubcommand, separateGlobalArgs, and findFirstPositional.
 */
export function buildGlobalFlagLookup(globalExtracted: ExtractedFields): GlobalFlagLookup {
  const {
    aliasMap = new Map(),
    booleanFlags = new Set(),
    negationMap = new Map(),
    defaultNegationDisabledFields = new Set(),
  } = buildParserOptions(globalExtracted);
  const shortAliases = new Set<string>();
  for (const field of globalExtracted.fields) {
    for (const alias of getAllAliases(field)) {
      if (alias.length === 1) shortAliases.add(alias);
    }
  }
  return {
    aliasMap,
    booleanFlags,
    flagNames: new Set(globalExtracted.fields.map((f) => f.name)),
    cliNames: new Set(globalExtracted.fields.map((f) => f.cliName)),
    aliases: shortAliases,
    negationMap,
    defaultNegationDisabledFields,
  };
}

/**
 * Resolve a long option (--flag, --flag=value, --no-flag, --custom-negation)
 * against global flag lookup. Returns the resolved camelCase name and whether
 * it is a known global flag.
 *
 * `isSuppressedNegation` is true when the token matches a disabled default
 * `--no-X` form on the target field.
 * The caller may use this to keep argv scanning past such tokens (so a
 * trailing subcommand is still detected) even though they no longer negate.
 */
export function resolveGlobalLongOption(
  arg: string,
  lookup: GlobalFlagLookup,
): {
  resolvedName: string;
  withoutDashes: string;
  isNegated: boolean;
  isGlobal: boolean;
  isSuppressedNegation: boolean;
} {
  const withoutDashes = arg.includes("=") ? arg.slice(2, arg.indexOf("=")) : arg.slice(2);

  // Custom negation: `--disable-cache` (or its camelCase variant) → cache=false
  const customNegated = !arg.includes("=") ? lookup.negationMap.get(withoutDashes) : undefined;
  if (customNegated) {
    return {
      resolvedName: customNegated,
      withoutDashes,
      isNegated: true,
      isGlobal: lookup.flagNames.has(customNegated),
      isSuppressedNegation: false,
    };
  }

  // Default negation matches both `--no-flag` (kebab) and `--noFlag`
  // (camelCase), mirroring argv-parser for fields that opt in with
  // `negation: true`.
  const kebabNegated = withoutDashes.startsWith("no-");
  const camelNegated =
    !kebabNegated &&
    withoutDashes.length > 2 &&
    withoutDashes.startsWith("no") &&
    /[A-Z]/.test(withoutDashes[2]!);

  // argv-parser only treats `--no-foo` / `--noFoo` as negation when the literal
  // name is not itself a defined option (see argv-parser.ts:147/167). Mirror
  // that disambiguation so a global flag literally named `no-foo` isn't
  // misclassified as the negation of a (possibly non-existent) `foo`.
  if (kebabNegated || camelNegated) {
    const literalResolved = lookup.aliasMap.get(withoutDashes) ?? withoutDashes;
    if (lookup.flagNames.has(literalResolved) || lookup.cliNames.has(withoutDashes)) {
      return {
        resolvedName: literalResolved,
        withoutDashes,
        isNegated: false,
        isGlobal: true,
        isSuppressedNegation: false,
      };
    }
  }

  const defaultIsNegated = kebabNegated || camelNegated;
  const flagName = kebabNegated
    ? withoutDashes.slice(3)
    : camelNegated
      ? withoutDashes[2]!.toLowerCase() + withoutDashes.slice(3)
      : withoutDashes;
  const resolvedName = lookup.aliasMap.get(flagName) ?? flagName;
  // When the target field has not opted in to default negation, the default
  // `--no-X` form is suppressed: treat it as if it were not a known global flag.
  const suppressDefaultNegation =
    defaultIsNegated && lookup.defaultNegationDisabledFields.has(resolvedName);
  const isNegated = defaultIsNegated && !suppressDefaultNegation;
  const isGlobal =
    !suppressDefaultNegation &&
    (lookup.flagNames.has(resolvedName) ||
      lookup.cliNames.has(withoutDashes) ||
      lookup.cliNames.has(flagName));
  return {
    resolvedName,
    withoutDashes,
    isNegated,
    isGlobal,
    isSuppressedNegation: suppressDefaultNegation,
  };
}

/**
 * Check whether a non-boolean flag should consume the next argv token as its value.
 * Returns true when the next token exists, is not a flag, and the current flag
 * is not boolean / negated / using = syntax.
 */
function shouldConsumeValue(
  arg: string,
  resolvedName: string,
  isNegated: boolean,
  nextArg: string | undefined,
  booleanFlags: Set<string>,
): boolean {
  return (
    !arg.includes("=") &&
    !booleanFlags.has(resolvedName) &&
    !isNegated &&
    nextArg !== undefined &&
    !nextArg.startsWith("-")
  );
}

/**
 * Collect a recognized global flag (and its value if applicable) into `dest`,
 * returning how many argv positions were consumed (1 or 2).
 */
export function collectGlobalFlag(
  argv: string[],
  i: number,
  resolvedName: string,
  isNegated: boolean,
  booleanFlags: Set<string>,
  dest: string[],
): number {
  const arg = argv[i]!;
  dest.push(arg);
  if (shouldConsumeValue(arg, resolvedName, isNegated, argv[i + 1], booleanFlags)) {
    dest.push(argv[i + 1]!);
    return 2;
  }
  return 1;
}

/**
 * Result of scanning argv for subcommand position
 */
export interface ScanResult {
  /** Index of the subcommand in argv (-1 if not found) */
  subCommandIndex: number;
  /** Global arg tokens found before the subcommand */
  globalTokensBefore: string[];
  /** All tokens after the subcommand (the subcommand itself is excluded) */
  tokensAfterSubcommand: string[];
  /**
   * Default `--no-X` tokens that were skipped because the target field has not
   * opted in to default negation. They are unknown long flags from the parser's
   * point of view, so the caller should surface them through `unknownFlags`
   * to keep `unknownKeysMode` ("strict" / "strip" / "passthrough") consistent
   * with flags that appear after the subcommand.
   */
  suppressedTokens: string[];
}

/**
 * Scan argv to find the subcommand position, skipping over global flags.
 *
 * Walks argv and recognizes global flags (long, short, --no-*) so that
 * `my-cli --verbose build --output dist` correctly identifies `build` as
 * the subcommand (index 1) rather than treating `--verbose` as the subcommand.
 *
 * Limitation: flags appearing before the subcommand name are matched only
 * against the global schema. If a flag is defined in both global and a
 * subcommand's local schema, the pre-subcommand occurrence is always treated
 * as global because the local schema is not available until the subcommand is
 * identified (lazy-loaded commands make eager checking infeasible). Place
 * colliding flags after the subcommand name so that `separateGlobalArgs` can
 * apply local-precedence logic.
 *
 * @param argv - Command line arguments
 * @param subCommandNames - Valid subcommand names
 * @param globalExtracted - Extracted fields from global args schema
 * @returns Scan result with subcommand position and token separation
 */
export function scanForSubcommand(
  argv: string[],
  subCommandNames: string[],
  globalExtracted: ExtractedFields,
): ScanResult {
  const lookup = buildGlobalFlagLookup(globalExtracted);
  const subCommandNameSet = new Set(subCommandNames);
  const globalTokensBefore: string[] = [];
  const suppressedTokens: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    // Stop scanning on -- or builtin flags
    if (arg === "--" || BUILTIN_FLAGS.has(arg)) {
      break;
    }

    // Check for subcommand (non-flag argument that matches a subcommand name)
    if (!arg.startsWith("-") && subCommandNameSet.has(arg)) {
      return {
        subCommandIndex: i,
        globalTokensBefore,
        tokensAfterSubcommand: argv.slice(i + 1),
        suppressedTokens,
      };
    }

    // Long option: --flag or --flag=value or opt-in --no-flag
    if (arg.startsWith("--")) {
      const { resolvedName, isNegated, isGlobal, isSuppressedNegation } = resolveGlobalLongOption(
        arg,
        lookup,
      );

      if (isGlobal) {
        i += collectGlobalFlag(
          argv,
          i,
          resolvedName,
          isNegated,
          lookup.booleanFlags,
          globalTokensBefore,
        );
        continue;
      }

      // Suppressed default `--no-X` for a field without opt-in negation: keep
      // scanning so a trailing subcommand is still detected, but record the
      // token in `suppressedTokens` (not `globalTokensBefore`). The caller
      // surfaces these as unknown flags so that `unknownKeysMode` applies
      // consistently with flags placed after the subcommand.
      if (isSuppressedNegation) {
        suppressedTokens.push(arg.includes("=") ? arg.slice(2, arg.indexOf("=")) : arg.slice(2));
        i++;
        continue;
      }

      // Unknown long flag - not a global flag, stop
      break;
    }

    // Short option: -f or -f=value
    if (arg.startsWith("-") && arg.length > 1) {
      const withoutDash = arg.includes("=") ? arg.slice(1, arg.indexOf("=")) : arg.slice(1);

      if (withoutDash.length === 1) {
        const resolvedName = lookup.aliasMap.get(withoutDash) ?? withoutDash;
        const isKnownGlobal = lookup.aliases.has(withoutDash) || lookup.flagNames.has(resolvedName);

        if (isKnownGlobal) {
          i += collectGlobalFlag(
            argv,
            i,
            resolvedName,
            false,
            lookup.booleanFlags,
            globalTokensBefore,
          );
          continue;
        }
      }

      // Unknown short flag or combined flags - stop scanning
      break;
    }

    // Non-flag, non-subcommand positional - stop scanning
    break;
  }

  // No subcommand found
  return {
    subCommandIndex: -1,
    globalTokensBefore,
    tokensAfterSubcommand: [],
    suppressedTokens,
  };
}

const BUILTIN_FLAGS = new Set(["--help", "-h", "--help-all", "-H", "--version"]);

/**
 * Find the index of the first positional argument in argv, properly skipping
 * global flag values. Returns -1 when no positional is present.
 *
 * Mirrors `scanForSubcommand`'s conservative stop conditions: the scan stops
 * (returning -1) on a `--` terminator, a builtin flag (`--help`/`--version`),
 * an unknown long flag, or an unknown/combined short flag. Past such tokens we
 * can't tell a flag *value* from a positional, so continuing would misclassify
 * e.g. `--help plugin` or `--unknown value` and wrongly trip plugin dispatch.
 *
 * Without globalExtracted, no flag is global, so any leading flag halts the
 * scan and a positional is only found when it precedes every flag.
 */
export function findFirstPositionalIndex(
  argv: string[],
  globalExtracted?: ExtractedFields,
): number {
  const lookup: GlobalFlagLookup = globalExtracted
    ? buildGlobalFlagLookup(globalExtracted)
    : {
        aliasMap: new Map(),
        booleanFlags: new Set(),
        flagNames: new Set(),
        cliNames: new Set(),
        aliases: new Set(),
        negationMap: new Map(),
        defaultNegationDisabledFields: new Set(),
      };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) return i;

    // `--` terminator or builtin flags (--help/--version/...): stop scanning.
    if (arg === "--" || BUILTIN_FLAGS.has(arg)) return -1;

    // Long option
    if (arg.startsWith("--")) {
      const { resolvedName, isNegated, isGlobal, isSuppressedNegation } = resolveGlobalLongOption(
        arg,
        lookup,
      );
      if (isGlobal) {
        if (shouldConsumeValue(arg, resolvedName, isNegated, argv[i + 1], lookup.booleanFlags)) {
          i++;
        }
        continue;
      }
      // Suppressed default `--no-X` for a field without opt-in negation: keep scanning
      // so a trailing positional is still detected (mirrors scanForSubcommand).
      if (isSuppressedNegation) continue;
      // Unknown long flag: stop.
      return -1;
    }

    // Short option(s): -f, -f=value, or combined -abc
    const withoutDash = arg.includes("=") ? arg.slice(1, arg.indexOf("=")) : arg.slice(1);
    if (withoutDash.length === 1) {
      const resolvedName = lookup.aliasMap.get(withoutDash) ?? withoutDash;
      const isKnownGlobal = lookup.aliases.has(withoutDash) || lookup.flagNames.has(resolvedName);
      if (isKnownGlobal) {
        if (shouldConsumeValue(arg, resolvedName, false, argv[i + 1], lookup.booleanFlags)) {
          i++;
        }
        continue;
      }
    }
    // Unknown short flag or combined short flags: stop.
    return -1;
  }
  return -1;
}

/**
 * Find the first positional argument in argv, properly skipping global flag
 * values. Thin wrapper over {@link findFirstPositionalIndex} — see that
 * function for the scan and stop conditions. Returns `undefined` when none.
 */
export function findFirstPositional(
  argv: string[],
  globalExtracted?: ExtractedFields,
): string | undefined {
  const index = findFirstPositionalIndex(argv, globalExtracted);
  return index >= 0 ? argv[index] : undefined;
}
