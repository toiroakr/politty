import {
  extractFields,
  getAllAliases,
  selectDiscriminatedVariant,
  toCamelCase,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "../core/schema-extractor.js";
import { listSubCommandNamesWithAliases } from "../executor/subcommand-router.js";
import type { AnyCommand } from "../types.js";
import {
  validateCaseVariantCollisions,
  validateCrossSchemaCollisions,
  validateDuplicateAliases,
  validateDuplicateFields,
  validateDuplicateNegations,
  validatePositionalConfig,
  validateReservedAliases,
  validateReservedFieldNames,
} from "../validator/command-validator.js";
import {
  buildParserOptions,
  mergeWithPositionals,
  parseArgv,
  positionalSlotFields,
} from "./argv-parser.js";
import { coerceEnvValue } from "./coerce-boolean.js";
import {
  buildGlobalFlagLookup,
  collectGlobalFlag,
  resolveGlobalLongOption,
  scanForSubcommand,
} from "./subcommand-scanner.js";

/**
 * Result of parsing CLI arguments
 */
export interface ParseResult {
  /** Help flag was requested (--help or -h) */
  helpRequested: boolean;
  /** Detailed help flag was requested (--help-all) */
  helpAllRequested: boolean;
  /** Structured (JSON) help flag was requested (--help-json) */
  helpJsonRequested: boolean;
  /** Version flag was requested (--version) */
  versionRequested: boolean;
  /** Detected subcommand name */
  subCommand?: string | undefined;
  /** Remaining args after subcommand extraction */
  remainingArgs: string[];
  /** Parsed arguments (not yet validated) */
  rawArgs: Record<string, unknown>;
  /** Positional argument values */
  positionals: string[];
  /** Arguments after -- (passed as explicit positionals) */
  rest: string[];
  /** Unknown flags that were detected */
  unknownFlags: string[];
  /** Unknown flags from the global schema portion of argv */
  unknownGlobalFlags?: string[] | undefined;
  /** Extracted fields from schema (for internal use) */
  extractedFields?: ExtractedFields | undefined;
  /** Positional fields that took positional tokens (named positionals given as a long option excluded) */
  positionalSlotFields?: ResolvedFieldMeta[] | undefined;
  /** Raw parsed global args (before validation) */
  rawGlobalArgs?: Record<string, unknown> | undefined;
  /** Names of fields in `rawArgs` whose value came from `field.env` rather than the CLI */
  envFallbackFields?: Set<string> | undefined;
}

/**
 * Options for parseArgs
 */
export interface ParseArgsOptions {
  /** Skip command definition validation (useful in production where tests already verified) */
  skipValidation?: boolean | undefined;
  /** Extracted fields from global args schema */
  globalExtracted?: ExtractedFields | undefined;
}

/**
 * Parse CLI arguments for a command
 *
 * @param argv - Command line arguments
 * @param command - The command to parse for
 * @param options - Parse options
 * @returns Parse result
 */
export function parseArgs(
  argv: string[],
  command: AnyCommand,
  options: ParseArgsOptions = {},
): ParseResult {
  // Check for subcommand FIRST (before help/version)
  // This ensures `cmd subcmd --help` shows subcmd's help, not cmd's help
  const subCommandNameSet = listSubCommandNamesWithAliases(command);
  const subCommandNames = [...subCommandNameSet];
  const hasSubCommands = subCommandNames.length > 0;

  if (hasSubCommands && argv.length > 0) {
    // When global args schema is provided, use the scanner to skip over global flags
    if (options.globalExtracted) {
      const scanResult = scanForSubcommand(argv, subCommandNames, options.globalExtracted);
      if (scanResult.subCommandIndex >= 0) {
        // Parse global args from tokens before the subcommand
        const rawGlobalArgs = parseGlobalArgs(
          scanResult.globalTokensBefore,
          options.globalExtracted,
        );
        // Remaining args = global tokens after subcommand + tokens after subcommand
        // Global flags after subcommand will be parsed when the leaf command is reached
        return {
          helpRequested: false,
          helpAllRequested: false,
          helpJsonRequested: false,
          versionRequested: false,
          subCommand: argv[scanResult.subCommandIndex],
          remainingArgs: scanResult.tokensAfterSubcommand,
          rawArgs: {},
          positionals: [],
          rest: [],
          unknownFlags: scanResult.suppressedTokens,
          unknownGlobalFlags: scanResult.suppressedTokens,
          rawGlobalArgs,
        };
      }
    } else {
      const firstArg = argv[0];
      // Only treat as subcommand if it doesn't start with '-' (not a flag)
      if (firstArg && !firstArg.startsWith("-") && subCommandNameSet.has(firstArg)) {
        return {
          helpRequested: false,
          helpAllRequested: false,
          helpJsonRequested: false,
          versionRequested: false,
          subCommand: firstArg,
          remainingArgs: argv.slice(1),
          rawArgs: {},
          positionals: [],
          rest: [],
          unknownFlags: [],
        };
      }
    }
  }

  // Extract fields from schema and validate BEFORE checking help flags
  // This ensures validation errors are thrown even when --help is used
  let extracted: ExtractedFields | undefined;
  if (command.args) {
    extracted = extractFields(command.args);
    // Only validate if not skipped (tests can pre-validate, production can skip)
    if (!options.skipValidation) {
      validateDuplicateFields(extracted);
      validateCaseVariantCollisions(extracted);
      validateDuplicateAliases(extracted);
      validateDuplicateNegations(extracted);
      validatePositionalConfig(extracted);
      validateReservedAliases(extracted, hasSubCommands);
      validateReservedFieldNames(extracted);
      if (options.globalExtracted) {
        validateCrossSchemaCollisions(options.globalExtracted, extracted);
      }
    }
  }

  // When global args are defined, separate global flags from command-local args.
  // Do this before help/version handling so suppressed global negations still
  // honor the global unknownKeysMode instead of being bypassed by early help.
  let commandArgv = argv;
  let rawGlobalArgs: Record<string, unknown> | undefined;
  let suppressedGlobalFlags: string[] = [];
  if (options.globalExtracted) {
    const { separated, globalParsed, suppressedTokens } = separateGlobalArgs(
      argv,
      options.globalExtracted,
      extracted,
    );
    commandArgv = separated;
    rawGlobalArgs = globalParsed;
    suppressedGlobalFlags = suppressedTokens;
  }

  // Check for help/version flags only when no subcommand is detected.
  // -h/-H are treated as --help/--help-all unless explicitly overridden by user.
  // Note: only the current command's overrideBuiltinAlias is checked here.
  // Global options with alias 'h'/'H' do not participate in this override check.
  // Tokens after `--` are pure positionals, so help/version flags appearing
  // there (e.g. `mycli __complete --shell bash -- foo --help`) must not
  // trigger the help/version branch.
  const ddIdx = argv.indexOf("--");
  const flagScanArgv = ddIdx >= 0 ? argv.slice(0, ddIdx) : argv;
  const hasUserDefinedH =
    extracted?.fields.some(
      (f) => f.overrideBuiltinAlias === true && getAllAliases(f).includes("H"),
    ) ?? false;
  const hasUserDefinedh =
    extracted?.fields.some(
      (f) => f.overrideBuiltinAlias === true && getAllAliases(f).includes("h"),
    ) ?? false;
  const helpAllRequested =
    flagScanArgv.includes("--help-all") || (!hasUserDefinedH && flagScanArgv.includes("-H"));
  // --help-json has no short alias, so it needs no overrideBuiltinAlias check.
  const helpJsonRequested = flagScanArgv.includes("--help-json");
  const helpRequested =
    !helpAllRequested &&
    !helpJsonRequested &&
    (flagScanArgv.includes("--help") || (!hasUserDefinedh && flagScanArgv.includes("-h")));
  const versionRequested = flagScanArgv.includes("--version");

  if (helpRequested || helpAllRequested || helpJsonRequested || versionRequested) {
    return {
      helpRequested,
      helpAllRequested,
      helpJsonRequested,
      versionRequested,
      subCommand: undefined,
      remainingArgs: [],
      rawArgs: {},
      positionals: [],
      rest: [],
      unknownFlags: [],
      unknownGlobalFlags: suppressedGlobalFlags,
      rawGlobalArgs,
    };
  }

  // If no schema, split on -- manually so that flag-like tokens (e.g. `-x stray`)
  // are not silently consumed by the parser; everything before -- is a positional.
  if (!extracted) {
    const ddIdx = commandArgv.indexOf("--");
    const positionals = ddIdx >= 0 ? commandArgv.slice(0, ddIdx) : commandArgv;
    const rest = ddIdx >= 0 ? commandArgv.slice(ddIdx + 1) : [];
    return {
      helpRequested: false,
      helpAllRequested: false,
      helpJsonRequested: false,
      versionRequested: false,
      subCommand: undefined,
      remainingArgs: [],
      rawArgs: {},
      positionals,
      rest,
      unknownFlags: [],
      unknownGlobalFlags: suppressedGlobalFlags,
      rawGlobalArgs,
    };
  }

  const argvFields = selectArgvFields(extracted, commandArgv);

  // Build parser options from extracted fields
  const parserOptions = buildParserOptions(argvFields);

  // Parse argv
  const parsed = parseArgv(commandArgv, parserOptions);

  // Merge with positionals
  const rawArgs = mergeWithPositionals(parsed, argvFields);

  // Apply environment variable fallbacks
  const envFallbackFields = new Set<string>();
  for (const field of argvFields.fields) {
    if (field.env && rawArgs[field.name] === undefined) {
      // Normalize to array
      const envNames = Array.isArray(field.env) ? field.env : [field.env];

      // First defined env var wins
      for (const envName of envNames) {
        const envValue = process.env[envName];
        if (envValue !== undefined) {
          rawArgs[field.name] = coerceEnvValue(envValue, field.type);
          envFallbackFields.add(field.name);
          break;
        }
      }
    }
  }

  // Detect unknown flags
  const optionFields = argvFields.fields.filter((f) => f.named);
  const knownFlags = new Set(optionFields.map((f) => f.name));
  const knownCliNames = new Set(optionFields.map((f) => f.cliName));
  const knownAliases = new Set<string>();
  for (const f of optionFields) {
    for (const alias of getAllAliases(f)) knownAliases.add(alias);
  }

  // Also consider global flags as known
  if (options.globalExtracted) {
    for (const f of options.globalExtracted.fields) {
      knownFlags.add(f.name);
      knownCliNames.add(f.cliName);
      for (const alias of getAllAliases(f)) knownAliases.add(alias);
    }
  }

  const unknownFlags: string[] = [];

  for (const key of Object.keys(parsed.options)) {
    if (!knownFlags.has(key) && !knownCliNames.has(key) && !knownAliases.has(key)) {
      unknownFlags.push(key);
    }
  }

  return {
    helpRequested: false,
    helpAllRequested: false,
    helpJsonRequested: false,
    versionRequested: false,
    subCommand: undefined,
    remainingArgs: [],
    rawArgs,
    positionals: parsed.positionals,
    rest: parsed.rest,
    unknownFlags,
    unknownGlobalFlags: suppressedGlobalFlags,
    extractedFields: extracted,
    positionalSlotFields: positionalSlotFields(argvFields, parsed.options),
    rawGlobalArgs,
    envFallbackFields,
  };
}

/**
 * Fields that decide how argv is read. Variants may define the same argument
 * (the discriminator included) differently, so a discriminated union reads
 * argv with the variant whose own definitions read its discriminator value,
 * and a union with the first option whose definitions fit the tokens;
 * otherwise it is every extracted field.
 */
function selectArgvFields(extracted: ExtractedFields, argv: string[]): ExtractedFields {
  const { discriminator, variants, unionOptions } = extracted;
  if (discriminator && variants) {
    return selectDiscriminatedVariant(extracted, (fields) =>
      mergeWithPositionals(parseArgv(argv, buildParserOptions(fields)), fields),
    );
  }
  if (unionOptions) {
    const option = unionOptions.find((o) => fitsArgv(o, argv));
    return option ? { ...extracted, fields: option.fields } : extracted;
  }
  return extracted;
}

/**
 * Whether argv reads cleanly with these fields alone: every long or short
 * option is one they accept, no positional token is left over, and every
 * required argument gets a value from argv or its environment variable.
 */
function fitsArgv(extracted: ExtractedFields, argv: string[]): boolean {
  const parsed = parseArgv(argv, buildParserOptions(extracted));
  const optionFields = extracted.fields.filter((f) => f.named);
  const accepted = new Set(optionFields.flatMap((f) => [f.name, f.cliName, ...getAllAliases(f)]));
  if (Object.keys(parsed.options).some((key) => !accepted.has(key))) return false;

  const slots = positionalSlotFields(extracted, parsed.options);
  const tokenCount = parsed.positionals.length + parsed.rest.length;
  if (!slots.some((f) => f.type === "array") && tokenCount > slots.length) return false;

  const rawArgs = mergeWithPositionals(parsed, extracted);
  return extracted.fields.every(
    (f) =>
      !f.required ||
      rawArgs[f.name] !== undefined ||
      [f.env ?? []].flat().some((name) => process.env[name] !== undefined),
  );
}

/**
 * Parse global args from a list of tokens (e.g., tokens before the subcommand).
 * Env fallbacks are applied later in the runner on the accumulated global args.
 */
function parseGlobalArgs(
  tokens: string[],
  globalExtracted: ExtractedFields,
): Record<string, unknown> {
  if (tokens.length === 0) return {};

  const parserOptions = buildParserOptions(globalExtracted);
  const parsed = parseArgv(tokens, parserOptions);
  return mergeWithPositionals(parsed, globalExtracted);
}

/**
 * Separate global flags from command-local args in argv.
 * Global flags mixed with command args (e.g., `build --verbose --output dist`)
 * are extracted and returned separately.
 * When a flag is defined in both global and local schemas, the local definition
 * takes precedence (the flag stays in the command tokens).
 *
 * Note: Combined short flags (e.g., `-vq`) are not decomposed here; only
 * single-character short options are recognized as global. The underlying
 * `parseArgv` handles combined shorts for command-local parsing.
 */
function separateGlobalArgs(
  argv: string[],
  globalExtracted: ExtractedFields,
  localExtracted?: ExtractedFields,
): { separated: string[]; globalParsed: Record<string, unknown>; suppressedTokens: string[] } {
  const lookup = buildGlobalFlagLookup(globalExtracted);

  // Local schema fields for collision detection: local takes precedence.
  // Collect field names, CLI names, and aliasMap keys (which include implicit
  // camelCase variants of hyphenated names/aliases) so that e.g. `--toBe` is
  // correctly recognised as local when `alias: "to-be"`, and `--fooBar` is
  // recognised as local when the field is named `fooBar` (cliName `foo-bar`).
  const localFieldNames = new Set(localExtracted?.fields.map((f) => f.name) ?? []);
  const localCliNames = new Set(localExtracted?.fields.map((f) => f.cliName) ?? []);
  const localParserOptions = localExtracted ? buildParserOptions(localExtracted) : undefined;
  const localAliasMapKeys = new Set(localParserOptions?.aliasMap?.keys() ?? []);
  const localNegationMapKeys = new Set(localParserOptions?.negationMap?.keys() ?? []);
  const localDefaultNegationKeys = new Set<string>();
  for (const field of localExtracted?.fields ?? []) {
    if (field.type !== "boolean" || field.negation !== true) continue;
    for (const name of [field.cliName, ...getAllAliases(field)]) {
      const kebab = `no-${name}`;
      localDefaultNegationKeys.add(kebab);
      localDefaultNegationKeys.add(toCamelCase(kebab));
    }
  }

  const globalTokens: string[] = [];
  const commandTokens: string[] = [];
  const suppressedTokens: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;

    if (arg === "--") {
      commandTokens.push(...argv.slice(i));
      break;
    }

    // Long option
    if (arg.startsWith("--")) {
      const { resolvedName, withoutDashes, isNegated, isGlobal, isSuppressedNegation } =
        resolveGlobalLongOption(arg, lookup);
      // Use resolvedName for local collision check so that both default
      // (`--no-cache` → cache) and custom (`--disable-cache` → cache)
      // negation forms shadow correctly when `cache` is defined locally.
      const flagName = resolvedName;

      // If also defined locally (field name, cliName, alias, or their camelCase
      // variants), let the local parser handle it
      const isLocalCollision =
        localFieldNames.has(withoutDashes) ||
        localFieldNames.has(flagName) ||
        localCliNames.has(withoutDashes) ||
        localCliNames.has(flagName) ||
        localAliasMapKeys.has(withoutDashes) ||
        localAliasMapKeys.has(flagName) ||
        localNegationMapKeys.has(withoutDashes) ||
        localNegationMapKeys.has(flagName) ||
        localDefaultNegationKeys.has(withoutDashes);

      if (isGlobal && !isLocalCollision) {
        // collectGlobalFlag returns 1 or 2; subtract 1 because the for-loop increments
        i +=
          collectGlobalFlag(argv, i, resolvedName, isNegated, lookup.booleanFlags, globalTokens) -
          1;
        continue;
      }

      if (isSuppressedNegation && !isLocalCollision) {
        suppressedTokens.push(withoutDashes);
        continue;
      }
    } else if (arg.startsWith("-") && arg.length > 1) {
      // Short option
      const withoutDash = arg.includes("=") ? arg.slice(1, arg.indexOf("=")) : arg.slice(1);

      if (withoutDash.length === 1) {
        const resolvedName = lookup.aliasMap.get(withoutDash) ?? withoutDash;
        const isKnownGlobal = lookup.aliases.has(withoutDash) || lookup.flagNames.has(resolvedName);

        // If also defined locally, let the local parser handle it
        if (isKnownGlobal && !localAliasMapKeys.has(withoutDash)) {
          i +=
            collectGlobalFlag(argv, i, resolvedName, false, lookup.booleanFlags, globalTokens) - 1;
          continue;
        }
      }
    }

    // Positional, local flag, or unknown flag: leave in command tokens
    commandTokens.push(arg);
  }

  const globalParsed = parseGlobalArgs(globalTokens, globalExtracted);
  return { separated: commandTokens, globalParsed, suppressedTokens };
}
