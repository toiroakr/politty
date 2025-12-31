import { extractFields, type ExtractedFields } from "../core/schema-extractor.js";
import type { AnyCommand } from "../types.js";
import {
    validateDuplicateAliases,
    validateDuplicateFields,
    validatePositionalConfig,
    validateReservedAliases
} from "../validator/command-validator.js";
import { buildParserOptions, mergeWithPositionals, parseArgv } from "./argv-parser.js";

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
}

/**
 * Options for parseArgs
 */
export interface ParseArgsOptions {
  /** Skip command definition validation (useful in production where tests already verified) */
  skipValidation?: boolean | undefined;
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

  // If no schema, return minimal result
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
    };
  }

  // Build parser options from extracted fields
  const parserOptions = buildParserOptions(extracted);

  // Parse argv
  const parsed = parseArgv(argv, parserOptions);

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
  };
}
