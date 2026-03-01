/**
 * Parse completion context from partial command line
 */

import { extractFields } from "../../core/schema-extractor.js";
import { isLazyCommand } from "../../lazy.js";
import type { AnyCommand } from "../../types.js";
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
}

/**
 * Extract options from a command
 */
function extractOptions(command: AnyCommand): CompletableOption[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
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
 * Get subcommand names from a command
 */
function getSubcommandNames(command: AnyCommand): string[] {
  if (!command.subCommands) {
    return [];
  }
  // Filter out internal subcommands (e.g., __complete)
  return Object.keys(command.subCommands).filter((name) => !name.startsWith("__"));
}

/**
 * Resolve subcommand by name
 */
function resolveSubcommand(command: AnyCommand, name: string): AnyCommand | null {
  if (!command.subCommands) {
    return null;
  }

  const sub = command.subCommands[name];
  if (!sub) {
    return null;
  }

  // LazyCommand: return metadata for sync inspection
  if (isLazyCommand(sub)) {
    return sub.meta;
  }

  // Skip legacy async subcommands (can't inspect statically)
  if (typeof sub === "function") {
    return null;
  }

  return sub;
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
  return options.find((opt) => opt.cliName === nameOrAlias || opt.alias === nameOrAlias);
}

/**
 * Parse completion context from command line arguments
 *
 * @param argv - Arguments after the program name (e.g., ["build", "--fo"])
 * @param rootCommand - The root command
 * @returns Completion context
 */
export function parseCompletionContext(argv: string[], rootCommand: AnyCommand): CompletionContext {
  // Initialize with root command
  let currentCommand = rootCommand;
  const subcommandPath: string[] = [];

  // Track used options and positional count
  const usedOptions = new Set<string>();
  let positionalCount = 0;

  // Process arguments to resolve subcommands and track state
  let i = 0;
  let options = extractOptions(currentCommand);
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
        if (opt.alias) usedOptions.add(opt.alias);

        // Skip next word if option takes value and doesn't have inline value
        if (opt.takesValue && !hasInlineValue(word)) {
          i++;
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
      options = extractOptions(currentCommand);
      usedOptions.clear(); // Reset for new subcommand
      positionalCount = 0;
      i++;
      continue;
    }

    // Otherwise it's a positional argument
    positionalCount++;
    i++;
  }

  // Get current and previous word
  const currentWord: string = argv[argv.length - 1] ?? "";
  const previousWord: string = argv[argv.length - 2] ?? "";

  // Extract data for current command
  const positionals = extractPositionalsForContext(currentCommand);
  const subcommands = getSubcommandNames(currentCommand);

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
