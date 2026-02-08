import { extractFields, type ExtractedFields } from "../core/schema-extractor.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import {
  validateDuplicateAliases,
  validateDuplicateFields,
  validatePositionalConfig,
  validateReservedAliases,
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
  /** Parsed global arguments (not yet validated) */
  globalRawArgs?: Record<string, unknown> | undefined;
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
  /** Global arguments schema (available to all subcommands) */
  globalArgsSchema?: ArgsSchema | undefined;
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
  // Check for subcommand (before help/version when subcommand is first positional)
  // This ensures `cmd subcmd --help` shows subcmd's help, not cmd's help
  const subCommandNames = command.subCommands ? Object.keys(command.subCommands) : [];
  const hasSubCommands = subCommandNames.length > 0;

  // Simple subcommand detection when no globalArgsSchema:
  // Check if first positional (first arg that doesn't start with -) is a subcommand
  // This maintains backward compatibility where `cli build --help` routes to build
  if (hasSubCommands && argv.length > 0 && !options.globalArgsSchema) {
    const firstArg = argv[0]!;
    // Only check if it's not a flag
    if (!firstArg.startsWith("-") && subCommandNames.includes(firstArg)) {
      return {
        helpRequested: false,
        helpAllRequested: false,
        versionRequested: false,
        subCommand: firstArg,
        remainingArgs: argv.slice(1),
        rawArgs: {},
        globalRawArgs: undefined,
        positionals: [],
        unknownFlags: [],
      };
    }
  }

  // Find subcommand: look for first positional that matches a subcommand name
  // This allows `cli --global-opt subcommand --subcmd-opt` pattern
  // Only perform this scanning when globalArgsSchema is provided, since without
  // global args there's no valid reason for flags to appear before subcommands
  if (hasSubCommands && argv.length > 0 && options.globalArgsSchema) {
    // First, check if first non-flag argument is a subcommand
    // We need to handle global options that may come before the subcommand
    let subCommandIndex = -1;
    let skipNext = false;

    // Builtin flags that should stop the scan and be handled by normal parsing
    const builtinFlags = new Set(["--help", "-h", "--help-all", "-H", "--version"]);

    // Extract global args fields to know which flags take values
    const globalExtractedForSubcmd = extractFields(options.globalArgsSchema);

    // Build set of known global flags
    const knownGlobalFlags = new Set<string>();
    const flagsWithValues = new Set<string>();
    for (const field of globalExtractedForSubcmd.fields) {
      knownGlobalFlags.add(`--${field.cliName}`);
      knownGlobalFlags.add(`--${field.name}`);
      if (field.alias) {
        knownGlobalFlags.add(`-${field.alias}`);
      }
      if (field.type !== "boolean") {
        flagsWithValues.add(`--${field.cliName}`);
        flagsWithValues.add(`--${field.name}`);
        if (field.alias) {
          flagsWithValues.add(`-${field.alias}`);
        }
      }
    }

    for (let i = 0; i < argv.length; i++) {
      if (skipNext) {
        skipNext = false;
        continue;
      }

      const arg = argv[i]!;

      if (arg.startsWith("-")) {
        // Check if this flag takes a value
        const flagName = arg.includes("=") ? arg.split("=")[0]! : arg;

        // Stop scanning if we encounter a builtin flag - let normal parsing handle it
        if (builtinFlags.has(flagName)) {
          break;
        }

        // Stop scanning if we encounter an unknown flag - let normal parsing handle it
        // This ensures unknown flags are properly reported as errors
        if (!knownGlobalFlags.has(flagName)) {
          break;
        }

        if (flagsWithValues.has(flagName) && !arg.includes("=")) {
          // This flag takes a value, skip the next argument
          skipNext = true;
        }
        continue;
      }

      // Found a positional argument - check if it's a subcommand
      if (subCommandNames.includes(arg)) {
        subCommandIndex = i;
        break;
      }

      // Not a subcommand, stop looking (positional args belong to current command)
      break;
    }

    if (subCommandIndex >= 0) {
      const subCommand = argv[subCommandIndex]!;
      // Arguments before subcommand go to global args parsing
      // Arguments after subcommand go to the subcommand
      const argsBeforeSubcmd = argv.slice(0, subCommandIndex);
      const argsAfterSubcmd = argv.slice(subCommandIndex + 1);

      // Parse global args from argsBeforeSubcmd
      let globalRawArgs: Record<string, unknown>;
      if (argsBeforeSubcmd.length > 0) {
        const globalParserOptions = buildParserOptions(globalExtractedForSubcmd);
        const globalParsed = parseArgv(argsBeforeSubcmd, globalParserOptions);
        globalRawArgs = mergeWithPositionals(globalParsed, globalExtractedForSubcmd);
      } else {
        globalRawArgs = {};
      }

      // Apply environment variable fallbacks for global fields
      for (const field of globalExtractedForSubcmd.fields) {
        if (field.env && globalRawArgs[field.name] === undefined) {
          const envNames = Array.isArray(field.env) ? field.env : [field.env];
          for (const envName of envNames) {
            const envValue = process.env[envName];
            if (envValue !== undefined) {
              globalRawArgs[field.name] = envValue;
              break;
            }
          }
        }
      }

      return {
        helpRequested: false,
        helpAllRequested: false,
        versionRequested: false,
        subCommand,
        remainingArgs: argsAfterSubcmd,
        rawArgs: {},
        globalRawArgs,
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

  // Extract global args fields
  let globalExtracted: ExtractedFields | undefined;
  if (options.globalArgsSchema) {
    globalExtracted = extractFields(options.globalArgsSchema);
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

  // If no command schema and no global schema, return minimal result
  if (!extracted && !globalExtracted) {
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

  // Merge command fields with global fields for parsing
  // Global fields are included so they can be parsed, but will be separated later
  const allFields = [...(extracted?.fields ?? []), ...(globalExtracted?.fields ?? [])];

  // Create merged ExtractedFields for parsing
  // Note: schema is required by ExtractedFields but not used by buildParserOptions
  // We use the command schema if available, otherwise the global schema
  const mergedExtracted: ExtractedFields = {
    fields: allFields,
    schema: (extracted?.schema ?? globalExtracted?.schema)!,
    unknownKeysMode: extracted?.unknownKeysMode ?? globalExtracted?.unknownKeysMode ?? "strip",
    schemaType: extracted?.schemaType ?? "object",
  };

  // Build parser options from merged fields
  const parserOptions = buildParserOptions(mergedExtracted);

  // Parse argv
  const parsed = parseArgv(argv, parserOptions);

  // Separate global args from command args
  const globalFieldNames = new Set(globalExtracted?.fields.map((f) => f.name) ?? []);
  const globalRawArgs: Record<string, unknown> = {};
  const rawArgs: Record<string, unknown> = {};

  // Merge with positionals (only for command fields)
  if (extracted) {
    const commandRawArgs = mergeWithPositionals(parsed, extracted);
    for (const [key, value] of Object.entries(commandRawArgs)) {
      if (!globalFieldNames.has(key)) {
        rawArgs[key] = value;
      }
    }
  }

  // Extract global args from parsed options
  for (const field of globalExtracted?.fields ?? []) {
    const value = parsed.options[field.name] ?? parsed.options[field.cliName];
    if (value !== undefined) {
      globalRawArgs[field.name] = value;
    }
  }

  // Apply environment variable fallbacks for command fields
  for (const field of extracted?.fields ?? []) {
    if (field.env && rawArgs[field.name] === undefined) {
      const envNames = Array.isArray(field.env) ? field.env : [field.env];
      for (const envName of envNames) {
        const envValue = process.env[envName];
        if (envValue !== undefined) {
          rawArgs[field.name] = envValue;
          break;
        }
      }
    }
  }

  // Apply environment variable fallbacks for global fields
  for (const field of globalExtracted?.fields ?? []) {
    if (field.env && globalRawArgs[field.name] === undefined) {
      const envNames = Array.isArray(field.env) ? field.env : [field.env];
      for (const envName of envNames) {
        const envValue = process.env[envName];
        if (envValue !== undefined) {
          globalRawArgs[field.name] = envValue;
          break;
        }
      }
    }
  }

  // Detect unknown flags (check against both command and global fields)
  const knownFlags = new Set(allFields.map((f) => f.name));
  const knownCliNames = new Set(allFields.map((f) => f.cliName));
  const knownAliases = new Set(allFields.filter((f) => f.alias).map((f) => f.alias!));
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
    globalRawArgs: globalExtracted ? globalRawArgs : undefined,
    positionals: parsed.positionals,
    unknownFlags,
    extractedFields: extracted,
  };
}
