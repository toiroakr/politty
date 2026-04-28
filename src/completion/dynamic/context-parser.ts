/**
 * Parse completion context from partial command line
 */

import { extractFields, toCamelCase } from "../../core/schema-extractor.js";
import { resolveSubCommandAlias } from "../../executor/subcommand-router.js";
import { resolveSubCommandMeta } from "../../lazy.js";
import type { AnyCommand, ArgsSchema } from "../../types.js";
import type { CompletableOption, CompletablePositional } from "../types.js";
import { resolveValueCompletion } from "../value-completion-resolver.js";

/**
 * Completion type indicates what kind of completion is expected
 */
export type CompletionType =
  | "subcommand" // Completing a subcommand name
  | "option-name" // Completing an option name (--xxx, -x)
  | "option-value" // Completing an option's value
  | "positional"; // Completing a positional argument

/**
 * Context for completion at current cursor position
 */
export interface CompletionContext {
  /** Subcommand path from root (e.g., ["plugin", "add"]) */
  subcommandPath: string[];
  /** The resolved command at current path */
  currentCommand: AnyCommand;
  /** Current word being typed (may be partial) */
  currentWord: string;
  /** Previous word (useful for option value detection) */
  previousWord: string;
  /** What type of completion is expected */
  completionType: CompletionType;
  /** Target option when completing option value */
  targetOption?: CompletableOption | undefined;
  /** Positional index when completing positional argument */
  positionalIndex?: number | undefined;
  /** Available options for current command */
  options: CompletableOption[];
  /** Available subcommands */
  subcommands: string[];
  /** Available positionals */
  positionals: CompletablePositional[];
  /** Options already used (to avoid duplicates) */
  usedOptions: Set<string>;
  /** Number of positional arguments already provided */
  providedPositionalCount: number;
  /**
   * Best-effort parsed values for the CURRENT command, keyed by camelCase
   * field name. Includes positionals (single value or string[] for variadic
   * positionals) and options (string for scalars, string[] for array
   * options). Zod validation is NOT applied — values are raw strings.
   */
  parsedArgs: Record<string, unknown>;
  /**
   * Values already supplied for the option/positional currently being
   * completed (for de-duplicating array options and oneof exclusivity in
   * dynamic resolvers).
   */
  previousValues: string[];
}

/**
 * Extract options from a command
 */
function extractOptions(command: AnyCommand): CompletableOption[] {
  if (!command.args) {
    return [];
  }
  return extractOptionsFromSchema(command.args);
}

function extractOptionsFromSchema(schema: ArgsSchema): CompletableOption[] {
  const extracted = extractFields(schema);
  return extracted.fields
    .filter((field) => !field.positional)
    .map((field) => ({
      name: field.name,
      cliName: field.cliName,
      alias: field.alias,
      description: field.description,
      takesValue: field.type !== "boolean",
      valueType: field.type,
      required: field.required,
      valueCompletion: resolveValueCompletion(field),
    }));
}

/** Merge global options into local, with local shadowing on cliName collision. */
function mergeGlobalOptions(
  local: CompletableOption[],
  globals: CompletableOption[],
): CompletableOption[] {
  if (globals.length === 0) return local;
  const seen = new Set(local.map((o) => o.cliName));
  const merged = [...local];
  for (const g of globals) {
    if (!seen.has(g.cliName)) merged.push(g);
  }
  return merged;
}

/**
 * Extract positionals from a command
 */
function extractPositionalsForContext(command: AnyCommand): CompletablePositional[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
  return extracted.fields
    .filter((field) => field.positional)
    .map((field, index) => ({
      name: field.name,
      cliName: field.cliName,
      position: index,
      description: field.description,
      required: field.required,
      variadic: field.type === "array",
      valueCompletion: resolveValueCompletion(field),
    }));
}

/**
 * Get subcommand names from a command (including aliases)
 */
function getSubcommandNames(command: AnyCommand): string[] {
  if (!command.subCommands) {
    return [];
  }
  const names: string[] = [];
  for (const [name, subCmd] of Object.entries(command.subCommands)) {
    // Filter out internal subcommands (e.g., __complete)
    if (name.startsWith("__")) continue;
    names.push(name);
    const meta = resolveSubCommandMeta(subCmd);
    if (meta?.aliases) {
      names.push(...meta.aliases);
    }
  }
  return names;
}

/**
 * Resolve subcommand by name (including alias lookup)
 */
function resolveSubcommand(command: AnyCommand, name: string): AnyCommand | null {
  if (!command.subCommands) {
    return null;
  }

  // Direct lookup
  const sub = command.subCommands[name];
  if (sub) {
    return resolveSubCommandMeta(sub);
  }

  // Alias lookup
  const canonical = resolveSubCommandAlias(command, name);
  if (canonical) {
    return resolveSubCommandMeta(command.subCommands[canonical]!);
  }

  return null;
}

/**
 * Check if a word is an option (starts with - or --)
 */
function isOption(word: string): boolean {
  return word.startsWith("-");
}

/**
 * Parse option name from word (e.g., "--foo=bar" -> "foo", "-v" -> "v")
 */
function parseOptionName(word: string): string {
  if (word.startsWith("--")) {
    const withoutPrefix = word.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");
    return eqIndex >= 0 ? withoutPrefix.slice(0, eqIndex) : withoutPrefix;
  }
  if (word.startsWith("-")) {
    return word.slice(1, 2); // First char after -
  }
  return word;
}

/**
 * Check if option has inline value (e.g., "--foo=bar")
 */
function hasInlineValue(word: string): boolean {
  return word.includes("=");
}

/**
 * Find option by name or alias
 */
function findOption(
  options: CompletableOption[],
  nameOrAlias: string,
): CompletableOption | undefined {
  return options.find((opt) => {
    if (opt.cliName === nameOrAlias) return true;
    if (opt.alias?.includes(nameOrAlias)) return true;
    // Also match camelCase variants of hyphenated aliases/cliName so that
    // e.g. --toBe is recognised when alias: "to-be" is defined.
    if (nameOrAlias.length > 1) {
      if (opt.cliName.includes("-") && toCamelCase(opt.cliName) === nameOrAlias) return true;
      if (opt.alias?.some((a) => a.includes("-") && toCamelCase(a) === nameOrAlias)) return true;
    }
    return false;
  });
}

/**
 * Parse completion context from command line arguments
 *
 * @param argv - Arguments after the program name (e.g., ["build", "--fo"])
 * @param rootCommand - The root command
 * @param globalArgsSchema - Optional global args. When provided, options
 *   derived from this schema are merged into every command level so dynamic
 *   resolvers attached to global options can be reached from any subcommand.
 * @returns Completion context
 */
export function parseCompletionContext(
  argv: string[],
  rootCommand: AnyCommand,
  globalArgsSchema?: ArgsSchema,
): CompletionContext {
  // Initialize with root command
  let currentCommand = rootCommand;
  const subcommandPath: string[] = [];

  const globalOptions = globalArgsSchema ? extractOptionsFromSchema(globalArgsSchema) : [];

  // Track used options and positional count
  const usedOptions = new Set<string>();
  let positionalCount = 0;

  // Best-effort parsed values for the CURRENT command. Reset when traversing
  // into a subcommand so dynamic resolvers only see siblings on the same
  // command frame. Global option values live in a separate map so they
  // survive subcommand descent — runtime accumulates globals across the
  // command path, and resolvers attached to global options expect them
  // visible regardless of where the option was supplied.
  let parsedArgs: Record<string, unknown> = {};
  let positionalValues: string[] = [];
  const globalParsedArgs: Record<string, unknown> = {};
  const globalOptionNames = new Set(globalOptions.map((o) => o.name));

  const recordOptionValue = (opt: CompletableOption, value: string): void => {
    const target = globalOptionNames.has(opt.name) ? globalParsedArgs : parsedArgs;
    if (opt.valueType === "array") {
      const existing = target[opt.name];
      target[opt.name] = Array.isArray(existing) ? [...existing, value] : [value];
    } else {
      target[opt.name] = value;
    }
  };

  // Process arguments to resolve subcommands and track state
  let i = 0;
  let options = mergeGlobalOptions(extractOptions(currentCommand), globalOptions);
  let afterDoubleDash = false;

  // Traverse subcommands
  while (i < argv.length - 1) {
    const word = argv[i]!;

    // "--" marks the end of option parsing
    if (!afterDoubleDash && word === "--") {
      afterDoubleDash = true;
      i++;
      continue;
    }

    // Skip options and their values (before "--")
    if (!afterDoubleDash && isOption(word)) {
      const optName = parseOptionName(word);
      const opt = findOption(options, optName);

      if (opt) {
        usedOptions.add(opt.cliName);
        if (opt.alias) {
          for (const a of opt.alias) usedOptions.add(a);
        }

        if (opt.takesValue) {
          if (hasInlineValue(word)) {
            const eqIdx = word.indexOf("=");
            recordOptionValue(opt, word.slice(eqIdx + 1));
          } else if (i + 1 < argv.length - 1) {
            // Skip next word if option takes value and doesn't have inline value
            recordOptionValue(opt, argv[i + 1]!);
            i++;
          }
        }
      }
      i++;
      continue;
    }

    // Check if this is a subcommand (before "--")
    const subcommand = afterDoubleDash ? null : resolveSubcommand(currentCommand, word);
    if (subcommand) {
      subcommandPath.push(word);
      currentCommand = subcommand;
      options = mergeGlobalOptions(extractOptions(currentCommand), globalOptions);
      usedOptions.clear(); // Reset for new subcommand
      positionalCount = 0;
      parsedArgs = {};
      positionalValues = [];
      i++;
      continue;
    }

    // Otherwise it's a positional argument
    positionalValues.push(word);
    positionalCount++;
    i++;
  }

  // Get current and previous word
  const currentWord: string = argv[argv.length - 1] ?? "";
  const previousWord: string = argv[argv.length - 2] ?? "";

  // Extract data for current command
  const positionals = extractPositionalsForContext(currentCommand);
  const subcommands = getSubcommandNames(currentCommand);

  // Map collected positional values to their field names so resolvers can
  // reference them like options. The trailing variadic positional (if any)
  // absorbs every value beyond `positionals.length - 1`.
  for (let p = 0; p < positionals.length; p++) {
    const pos = positionals[p]!;
    if (pos.variadic) {
      parsedArgs[pos.name] = positionalValues.slice(p);
      break;
    }
    if (p < positionalValues.length) {
      parsedArgs[pos.name] = positionalValues[p];
    }
  }

  // Determine completion type
  let completionType: CompletionType;
  let targetOption: CompletableOption | undefined;
  let positionalIndex: number | undefined;

  // Case 1: Previous word is an option that takes a value
  if (!afterDoubleDash && previousWord && isOption(previousWord) && !hasInlineValue(previousWord)) {
    const optName = parseOptionName(previousWord);
    const opt = findOption(options, optName);
    if (opt && opt.takesValue) {
      completionType = "option-value";
      targetOption = opt;
    } else if (currentWord.startsWith("-")) {
      // Previous word is boolean flag, current word starts with - → option name
      completionType = "option-name";
    } else {
      completionType = determineDefaultCompletionType(
        currentWord,
        subcommands,
        positionals,
        positionalCount,
      );
      if (completionType === "positional") {
        positionalIndex = positionalCount;
      }
    }
  }
  // Case 2: Current word is an option with inline value (--foo=)
  else if (!afterDoubleDash && currentWord.startsWith("--") && hasInlineValue(currentWord)) {
    const optName = parseOptionName(currentWord);
    const opt = findOption(options, optName);
    if (opt && opt.takesValue) {
      completionType = "option-value";
      targetOption = opt;
    } else {
      completionType = "option-name";
    }
  }
  // Case 3: Current word starts with - (completing option name)
  else if (!afterDoubleDash && currentWord.startsWith("-")) {
    completionType = "option-name";
  }
  // Case 4: Determine based on available subcommands and positionals
  else {
    completionType = determineDefaultCompletionType(
      currentWord,
      subcommands,
      positionals,
      positionalCount,
      afterDoubleDash,
    );
    if (completionType === "positional") {
      positionalIndex = positionalCount;
    }
  }

  // Compute previousValues for the target of completion. Useful for resolvers
  // that need to de-dup repeated array options or enforce oneof exclusivity.
  let previousValues: string[] = [];
  if (targetOption) {
    if (targetOption.valueType === "array") {
      const store = globalOptionNames.has(targetOption.name) ? globalParsedArgs : parsedArgs;
      const stored = store[targetOption.name];
      previousValues = Array.isArray(stored) ? (stored as string[]) : [];
    }
  } else if (completionType === "positional" && positionalIndex !== undefined) {
    // Clamp to the last positional so a variadic tail still receives the
    // previously-supplied values when positionalIndex outruns the schema
    // (e.g. completing the 3rd value of a single variadic positional).
    const lastIdx = positionals.length - 1;
    const clampedIdx = positionalIndex > lastIdx ? lastIdx : positionalIndex;
    const pos = clampedIdx >= 0 ? positionals[clampedIdx] : undefined;
    if (pos?.variadic) {
      previousValues = positionalValues.slice(clampedIdx);
    }
  }

  // Expose globals alongside locals; local args win on name collision.
  const mergedParsedArgs: Record<string, unknown> = { ...globalParsedArgs, ...parsedArgs };

  return {
    subcommandPath,
    currentCommand,
    currentWord,
    previousWord,
    completionType,
    targetOption,
    positionalIndex,
    options,
    subcommands,
    positionals,
    usedOptions,
    providedPositionalCount: positionalCount,
    parsedArgs: mergedParsedArgs,
    previousValues,
  };
}

/**
 * Determine default completion type when not completing an option
 */
function determineDefaultCompletionType(
  currentWord: string,
  subcommands: string[],
  positionals: CompletablePositional[],
  positionalCount: number,
  afterDoubleDash?: boolean,
): CompletionType {
  // After --, everything is positional — never suggest subcommands or options
  if (afterDoubleDash) {
    return "positional";
  }

  // If there are subcommands and current word might match one, suggest subcommands
  if (subcommands.length > 0) {
    // Check if any subcommand starts with current word
    const matchingSubcommands = subcommands.filter((s) => s.startsWith(currentWord));
    if (matchingSubcommands.length > 0 || currentWord === "") {
      return "subcommand";
    }
  }

  // If there are positionals to complete
  if (positionalCount < positionals.length) {
    return "positional";
  }

  // If the last positional is variadic (array), continue with positional
  if (positionals.length > 0 && positionals[positionals.length - 1]!.variadic) {
    return "positional";
  }

  // Default to subcommand (will show options too)
  return "subcommand";
}
