import type { ExtractedFields } from "../core/schema-extractor.js";
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
  /** single-char aliases */
  aliases: Set<string>;
}

/**
 * Build lookup tables from extracted global schema fields.
 * Shared by scanForSubcommand, separateGlobalArgs, and findFirstPositional.
 */
export function buildGlobalFlagLookup(globalExtracted: ExtractedFields): GlobalFlagLookup {
  const { aliasMap = new Map(), booleanFlags = new Set() } = buildParserOptions(globalExtracted);
  return {
    aliasMap,
    booleanFlags,
    flagNames: new Set(globalExtracted.fields.map((f) => f.name)),
    cliNames: new Set(globalExtracted.fields.map((f) => f.cliName)),
    aliases: new Set(globalExtracted.fields.filter((f) => f.alias).map((f) => f.alias!)),
  };
}

/**
 * Resolve a long option (--flag, --flag=value, --no-flag) against global flag lookup.
 * Returns the resolved camelCase name and whether it is a known global flag.
 */
export function resolveGlobalLongOption(
  arg: string,
  lookup: GlobalFlagLookup,
): { resolvedName: string; withoutDashes: string; isNegated: boolean; isGlobal: boolean } {
  const withoutDashes = arg.includes("=") ? arg.slice(2, arg.indexOf("=")) : arg.slice(2);
  const isNegated = withoutDashes.startsWith("no-");
  const flagName = isNegated ? withoutDashes.slice(3) : withoutDashes;
  const resolvedName = lookup.aliasMap.get(flagName) ?? flagName;
  const isGlobal =
    lookup.flagNames.has(resolvedName) ||
    lookup.cliNames.has(withoutDashes) ||
    lookup.cliNames.has(flagName);
  return { resolvedName, withoutDashes, isNegated, isGlobal };
}

/**
 * Check whether a non-boolean flag should consume the next argv token as its value.
 * Returns true when the next token exists, is not a flag, and the current flag
 * is not boolean / negated / using = syntax.
 */
export function shouldConsumeValue(
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
 * Result of scanning argv for subcommand position
 */
export interface ScanResult {
  /** Index of the subcommand in argv (-1 if not found) */
  subCommandIndex: number;
  /** Global arg tokens found before the subcommand */
  globalTokensBefore: string[];
  /** All tokens after the subcommand (the subcommand itself is excluded) */
  tokensAfterSubcommand: string[];
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
      };
    }

    // Long option: --flag or --flag=value or --no-flag
    if (arg.startsWith("--")) {
      const { resolvedName, isNegated, isGlobal } = resolveGlobalLongOption(arg, lookup);

      if (isGlobal) {
        globalTokensBefore.push(arg);
        if (shouldConsumeValue(arg, resolvedName, isNegated, argv[i + 1], lookup.booleanFlags)) {
          globalTokensBefore.push(argv[i + 1]!);
          i += 2;
          continue;
        }
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
          globalTokensBefore.push(arg);
          if (shouldConsumeValue(arg, resolvedName, false, argv[i + 1], lookup.booleanFlags)) {
            globalTokensBefore.push(argv[i + 1]!);
            i += 2;
            continue;
          }
          i++;
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
  };
}

const BUILTIN_FLAGS = new Set(["--help", "-h", "--help-all", "-H", "--version"]);

/**
 * Find the first positional argument in argv, properly skipping global flag values.
 * Without globalExtracted, falls back to the first non-flag token.
 */
export function findFirstPositional(
  argv: string[],
  globalExtracted?: ExtractedFields,
): string | undefined {
  if (!globalExtracted) {
    return argv.find((arg) => !arg.startsWith("-"));
  }

  const lookup = buildGlobalFlagLookup(globalExtracted);

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) return arg;
    if (arg === "--") return undefined;

    // Long option
    if (arg.startsWith("--")) {
      const { resolvedName, isNegated, isGlobal } = resolveGlobalLongOption(arg, lookup);
      if (
        isGlobal &&
        shouldConsumeValue(arg, resolvedName, isNegated, argv[i + 1], lookup.booleanFlags)
      ) {
        i++;
      }
      continue;
    }

    // Short option (-f)
    if (arg.length === 2) {
      const ch = arg[1]!;
      if (lookup.aliases.has(ch)) {
        const resolvedName = lookup.aliasMap.get(ch) ?? ch;
        if (shouldConsumeValue(arg, resolvedName, false, argv[i + 1], lookup.booleanFlags)) {
          i++;
        }
      }
    }
  }
  return undefined;
}
