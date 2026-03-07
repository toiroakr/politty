import { extractFields, type ExtractedFields } from "../core/schema-extractor.js";
import type { AnyCommand } from "../types.js";
import {
  validateDuplicateAliases,
  validateDuplicateFields,
  validatePositionalConfig,
  validateReservedAliases,
} from "../validator/command-validator.js";
import { buildParserOptions, mergeWithPositionals, parseArgv } from "./argv-parser.js";
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
  /** Unknown flags that were detected */
  unknownFlags: string[];
  /** Extracted fields from schema (for internal use) */
  extractedFields?: ExtractedFields | undefined;
  /** Raw parsed global args (before validation) */
  rawGlobalArgs?: Record<string, unknown> | undefined;
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
  const subCommandNames = command.subCommands ? Object.keys(command.subCommands) : [];
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
          versionRequested: false,
          subCommand: argv[scanResult.subCommandIndex],
          remainingArgs: scanResult.tokensAfterSubcommand,
          rawArgs: {},
          positionals: [],
          unknownFlags: [],
          rawGlobalArgs,
        };
      }
    } else {
      const firstArg = argv[0];
      // Only treat as subcommand if it doesn't start with '-' (not a flag)
      if (firstArg && !firstArg.startsWith("-") && subCommandNames.includes(firstArg)) {
        return {
          helpRequested: false,
          helpAllRequested: false,
          versionRequested: false,
          subCommand: firstArg,
          remainingArgs: argv.slice(1),
          rawArgs: {},
          positionals: [],
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
      validateDuplicateAliases(extracted);
      validatePositionalConfig(extracted);
      validateReservedAliases(extracted, hasSubCommands);
    }
  }

  // Check for help/version flags only when no subcommand is detected
  // -h/-H are treated as --help/--help-all unless explicitly overridden by user
  // Note: only the current command's overrideBuiltinAlias is checked here.
  // Global options with alias 'h'/'H' do not participate in this override check.
  const hasUserDefinedH =
    extracted?.fields.some((f) => f.alias === "H" && f.overrideBuiltinAlias === true) ?? false;
  const hasUserDefinedh =
    extracted?.fields.some((f) => f.alias === "h" && f.overrideBuiltinAlias === true) ?? false;
  const helpAllRequested = argv.includes("--help-all") || (!hasUserDefinedH && argv.includes("-H"));
  const helpRequested =
    !helpAllRequested && (argv.includes("--help") || (!hasUserDefinedh && argv.includes("-h")));
  const versionRequested = argv.includes("--version");

  if (helpRequested || helpAllRequested || versionRequested) {
    return {
      helpRequested,
      helpAllRequested,
      versionRequested,
      subCommand: undefined,
      remainingArgs: [],
      rawArgs: {},
      positionals: [],
      unknownFlags: [],
    };
  }

  // When global args are defined, separate global flags from command-local args
  let commandArgv = argv;
  let rawGlobalArgs: Record<string, unknown> | undefined;
  if (options.globalExtracted) {
    const { separated, globalParsed } = separateGlobalArgs(
      argv,
      options.globalExtracted,
      extracted,
    );
    commandArgv = separated;
    rawGlobalArgs = globalParsed;
  }

  // If no schema, return minimal result (but include any parsed global args)
  if (!extracted) {
    return {
      helpRequested: false,
      helpAllRequested: false,
      versionRequested: false,
      subCommand: undefined,
      remainingArgs: [],
      rawArgs: {},
      positionals: [],
      unknownFlags: [],
      rawGlobalArgs,
    };
  }

  // Build parser options from extracted fields
  const parserOptions = buildParserOptions(extracted);

  // Parse argv
  const parsed = parseArgv(commandArgv, parserOptions);

  // Merge with positionals
  const rawArgs = mergeWithPositionals(parsed, extracted);

  // Apply environment variable fallbacks
  for (const field of extracted.fields) {
    if (field.env && rawArgs[field.name] === undefined) {
      // Normalize to array
      const envNames = Array.isArray(field.env) ? field.env : [field.env];

      // First defined env var wins
      for (const envName of envNames) {
        const envValue = process.env[envName];
        if (envValue !== undefined) {
          rawArgs[field.name] = envValue;
          break;
        }
      }
    }
  }

  // Detect unknown flags
  const knownFlags = new Set(extracted.fields.map((f) => f.name));
  const knownCliNames = new Set(extracted.fields.map((f) => f.cliName));
  const knownAliases = new Set(extracted.fields.filter((f) => f.alias).map((f) => f.alias!));

  // Also consider global flags as known
  if (options.globalExtracted) {
    for (const f of options.globalExtracted.fields) {
      knownFlags.add(f.name);
      knownCliNames.add(f.cliName);
      if (f.alias) knownAliases.add(f.alias);
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
    versionRequested: false,
    subCommand: undefined,
    remainingArgs: [],
    rawArgs,
    positionals: parsed.positionals,
    unknownFlags,
    extractedFields: extracted,
    rawGlobalArgs,
  };
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
): { separated: string[]; globalParsed: Record<string, unknown> } {
  const lookup = buildGlobalFlagLookup(globalExtracted);

  // Local schema fields for collision detection: local takes precedence
  const localCliNames = new Set(localExtracted?.fields.map((f) => f.cliName) ?? []);
  const localAliases = new Set(
    localExtracted?.fields.filter((f) => f.alias).map((f) => f.alias!) ?? [],
  );

  const globalTokens: string[] = [];
  const commandTokens: string[] = [];

  let i = 0;
  while (i < argv.length) {
    const arg = argv[i]!;

    if (arg === "--") {
      commandTokens.push(...argv.slice(i));
      break;
    }

    // Long option
    if (arg.startsWith("--")) {
      const { resolvedName, withoutDashes, isNegated, isGlobal } = resolveGlobalLongOption(
        arg,
        lookup,
      );
      const flagName = isNegated ? withoutDashes.slice(3) : withoutDashes;

      // If also defined locally, let the local parser handle it
      const isLocalCollision = localCliNames.has(withoutDashes) || localCliNames.has(flagName);

      if (isGlobal && !isLocalCollision) {
        i += collectGlobalFlag(argv, i, resolvedName, isNegated, lookup.booleanFlags, globalTokens);
        continue;
      }

      // Local/unknown flag: leave in command tokens.
      // Value tokens (non-flag) will naturally land in commandTokens on the next iteration.
      commandTokens.push(arg);
      i++;
      continue;
    }

    // Short option
    if (arg.startsWith("-") && arg.length > 1) {
      const withoutDash = arg.includes("=") ? arg.slice(1, arg.indexOf("=")) : arg.slice(1);

      if (withoutDash.length === 1) {
        const resolvedName = lookup.aliasMap.get(withoutDash) ?? withoutDash;
        const isKnownGlobal = lookup.aliases.has(withoutDash) || lookup.flagNames.has(resolvedName);

        // If also defined locally, let the local parser handle it
        if (isKnownGlobal && !localAliases.has(withoutDash)) {
          i += collectGlobalFlag(argv, i, resolvedName, false, lookup.booleanFlags, globalTokens);
          continue;
        }
      }

      commandTokens.push(arg);
      i++;
      continue;
    }

    // Positional
    commandTokens.push(arg);
    i++;
  }

  const globalParsed = parseGlobalArgs(globalTokens, globalExtracted);
  return { separated: commandTokens, globalParsed };
}
