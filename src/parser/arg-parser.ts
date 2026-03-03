import { extractFieldsCached, type ExtractedFields } from "../core/schema-extractor.js";
import type { AnyCommand, GlobalArgsContext } from "../types.js";
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
  rawGlobalArgs: Record<string, unknown>;
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
  /** Runtime global args context */
  globalArgsContext?: GlobalArgsContext | undefined;
}

interface ParsedWithExtracted {
  rawArgs: Record<string, unknown>;
  positionals: string[];
  unknownFlags: string[];
}

const BUILTIN_LONG_FLAGS = new Set(["--help", "--help-all", "--version"]);
const BUILTIN_SHORT_FLAGS = new Set(["-h", "-H"]);

function applyEnvFallbacks(rawArgs: Record<string, unknown>, extracted?: ExtractedFields): void {
  if (!extracted) {
    return;
  }

  for (const field of extracted.fields) {
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
}

function parseWithExtracted(argv: string[], extracted: ExtractedFields): ParsedWithExtracted {
  const parserOptions = buildParserOptions(extracted);
  const parsed = parseArgv(argv, parserOptions);
  const rawArgs = mergeWithPositionals(parsed, extracted);
  applyEnvFallbacks(rawArgs, extracted);

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
    rawArgs,
    positionals: parsed.positionals,
    unknownFlags,
  };
}

function combineForLeafParsing(
  extracted: ExtractedFields | undefined,
  globalExtracted: ExtractedFields | undefined,
): ExtractedFields | undefined {
  if (extracted && !globalExtracted) {
    return extracted;
  }
  if (!extracted && globalExtracted) {
    return globalExtracted;
  }
  if (!extracted || !globalExtracted) {
    return undefined;
  }

  const commandParserKeys = new Set<string>();
  for (const field of extracted.fields) {
    commandParserKeys.add(field.name);
    commandParserKeys.add(field.cliName);
    if (field.alias) {
      commandParserKeys.add(field.alias);
    }
  }

  const extraGlobalFields = globalExtracted.fields.filter((field) => {
    const keys = [field.name, field.cliName, field.alias].filter(
      (key): key is string => key !== undefined,
    );
    return !keys.some((key) => commandParserKeys.has(key));
  });

  return {
    ...extracted,
    fields: [...extracted.fields, ...extraGlobalFields],
  };
}

function splitLeafRawArgs(
  rawAllArgs: Record<string, unknown>,
  extracted: ExtractedFields | undefined,
  globalExtracted: ExtractedFields | undefined,
): { rawArgs: Record<string, unknown>; rawGlobalArgs: Record<string, unknown> } {
  if (extracted && !globalExtracted) {
    return { rawArgs: rawAllArgs, rawGlobalArgs: {} };
  }

  if (!extracted && globalExtracted) {
    return { rawArgs: {}, rawGlobalArgs: rawAllArgs };
  }

  if (!extracted || !globalExtracted) {
    return { rawArgs: {}, rawGlobalArgs: {} };
  }

  const commandFieldNames = new Set(extracted.fields.map((field) => field.name));
  const globalFieldNames = new Set(globalExtracted.fields.map((field) => field.name));
  const rawArgs: Record<string, unknown> = {};
  const rawGlobalArgs: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(rawAllArgs)) {
    if (commandFieldNames.has(key)) {
      rawArgs[key] = value;
      continue;
    }

    if (globalFieldNames.has(key)) {
      rawGlobalArgs[key] = value;
    }
  }

  return { rawArgs, rawGlobalArgs };
}

function buildGlobalLongFlagMap(extracted: ExtractedFields): Map<string, { boolean: boolean }> {
  const map = new Map<string, { boolean: boolean }>();

  for (const field of extracted.fields) {
    const info = { boolean: field.type === "boolean" };
    map.set(field.name, info);
    map.set(field.cliName, info);
  }

  return map;
}

function buildGlobalShortFlagMap(extracted: ExtractedFields): Map<string, { boolean: boolean }> {
  const map = new Map<string, { boolean: boolean }>();

  for (const field of extracted.fields) {
    if (!field.alias) continue;
    map.set(field.alias, { boolean: field.type === "boolean" });
  }

  return map;
}

function findSubCommandPosition(
  argv: string[],
  subCommandNames: string[],
  globalExtracted: ExtractedFields,
): number | undefined {
  const globalLongFlags = buildGlobalLongFlagMap(globalExtracted);
  const globalShortFlags = buildGlobalShortFlagMap(globalExtracted);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;

    if (BUILTIN_LONG_FLAGS.has(token) || BUILTIN_SHORT_FLAGS.has(token)) {
      return undefined;
    }

    if (token === "--") {
      return undefined;
    }

    if (token.startsWith("--")) {
      const withoutDashes = token.slice(2);

      if (withoutDashes.startsWith("no-")) {
        const flagName = withoutDashes.slice(3);
        const info = globalLongFlags.get(flagName);
        if (info?.boolean) {
          continue;
        }
        return undefined;
      }

      const eqIndex = withoutDashes.indexOf("=");
      const name = eqIndex === -1 ? withoutDashes : withoutDashes.slice(0, eqIndex);
      const info = globalLongFlags.get(name);
      if (!info) {
        if (eqIndex === -1) {
          const nextToken = argv[i + 1];
          if (
            nextToken !== undefined &&
            !nextToken.startsWith("-") &&
            !subCommandNames.includes(nextToken)
          ) {
            i++;
          }
        }
        continue;
      }

      if (!info.boolean && eqIndex === -1) {
        const nextToken = argv[i + 1];
        if (nextToken !== undefined && !nextToken.startsWith("-")) {
          i++;
        }
      }

      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const withoutDash = token.slice(1);
      const eqIndex = withoutDash.indexOf("=");

      if (eqIndex !== -1) {
        const shortName = withoutDash.slice(0, eqIndex);
        if (shortName.length !== 1) {
          return undefined;
        }
        if (!globalShortFlags.has(shortName)) {
          return undefined;
        }
        continue;
      }

      if (withoutDash.length === 1) {
        const info = globalShortFlags.get(withoutDash);
        if (!info) {
          const nextToken = argv[i + 1];
          if (
            nextToken !== undefined &&
            !nextToken.startsWith("-") &&
            !subCommandNames.includes(nextToken)
          ) {
            i++;
          }
          continue;
        }

        if (!info.boolean) {
          const nextToken = argv[i + 1];
          if (nextToken !== undefined && !nextToken.startsWith("-")) {
            i++;
          }
        }
        continue;
      }

      const combinedFlags = [...withoutDash];
      if (combinedFlags.every((name) => globalShortFlags.get(name)?.boolean)) {
        continue;
      }

      return undefined;
    }

    if (subCommandNames.includes(token)) {
      return i;
    }

    return undefined;
  }

  return undefined;
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
  const globalArgsContext = options.globalArgsContext;
  const globalExtracted = globalArgsContext?.extractedFields;

  // Check for subcommand FIRST (before help/version)
  // This ensures `cmd subcmd --help` shows subcmd's help, not cmd's help
  const subCommandNames = command.subCommands ? Object.keys(command.subCommands) : [];
  const hasSubCommands = subCommandNames.length > 0;

  if (hasSubCommands && argv.length > 0) {
    if (globalExtracted) {
      const subCommandIndex = findSubCommandPosition(argv, subCommandNames, globalExtracted);
      if (subCommandIndex !== undefined) {
        const subCommand = argv[subCommandIndex];
        const globalArgsPrefix = argv.slice(0, subCommandIndex);
        const parsedGlobal = parseWithExtracted(globalArgsPrefix, globalExtracted);

        return {
          helpRequested: false,
          helpAllRequested: false,
          versionRequested: false,
          subCommand,
          remainingArgs: argv.slice(subCommandIndex + 1),
          rawArgs: {},
          rawGlobalArgs: parsedGlobal.rawArgs,
          positionals: parsedGlobal.positionals,
          unknownFlags: parsedGlobal.unknownFlags,
          extractedFields: globalExtracted,
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
          rawGlobalArgs: {},
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
    extracted = extractFieldsCached(command.args);
    // Only validate if not skipped (tests can pre-validate, production can skip)
    if (!options.skipValidation) {
      validateDuplicateFields(extracted);
      validateDuplicateAliases(extracted);
      validatePositionalConfig(extracted);
      validateReservedAliases(extracted, hasSubCommands);
    }
  }

  const allAliasFields = [...(extracted?.fields ?? []), ...(globalExtracted?.fields ?? [])];

  // Check for help/version flags only when no subcommand is detected
  // -h/-H are treated as --help/--help-all unless explicitly overridden by user
  const hasUserDefinedH =
    allAliasFields.some((f) => f.alias === "H" && f.overrideBuiltinAlias === true) ?? false;
  const hasUserDefinedh =
    allAliasFields.some((f) => f.alias === "h" && f.overrideBuiltinAlias === true) ?? false;
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
      rawGlobalArgs: {},
      positionals: [],
      unknownFlags: [],
    };
  }

  const parseExtracted = combineForLeafParsing(extracted, globalExtracted);

  // If no schema, return minimal result
  if (!parseExtracted) {
    return {
      helpRequested: false,
      helpAllRequested: false,
      versionRequested: false,
      subCommand: undefined,
      remainingArgs: [],
      rawArgs: {},
      rawGlobalArgs: {},
      positionals: [],
      unknownFlags: [],
    };
  }

  const parsed = parseWithExtracted(argv, parseExtracted);
  const split = splitLeafRawArgs(parsed.rawArgs, extracted, globalExtracted);

  return {
    helpRequested: false,
    helpAllRequested: false,
    versionRequested: false,
    subCommand: undefined,
    remainingArgs: [],
    rawArgs: split.rawArgs,
    rawGlobalArgs: split.rawGlobalArgs,
    positionals: parsed.positionals,
    unknownFlags: parsed.unknownFlags,
    extractedFields: extracted ?? globalExtracted,
  };
}
