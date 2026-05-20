/**
 * Parse completion context from partial command line
 */

import { extractFields, toCamelCase } from "../../core/schema-extractor.js";
import { resolveSubCommandAlias } from "../../executor/subcommand-router.js";
import { resolveSubCommandMeta } from "../../lazy.js";
import type { AnyCommand, ArgsSchema } from "../../types.js";
import type { CompletableOption, CompletablePositional, ValueCompletion } from "../types.js";
import {
  resolveValueCompletion,
  type PendingExpandValueCompletion,
} from "../value-completion-resolver.js";

/**
 * The dynamic completion path runs `__complete` at TAB time and never sees
 * "expand" fields (those are handled inline by the static shell script).
 * Strip the transient pending sentinel here so the rest of the runtime path
 * can stay strict about handling only resolved `ValueCompletion` values.
 */
function stripPendingExpand(
  vc: ValueCompletion | PendingExpandValueCompletion | undefined,
): ValueCompletion | undefined {
  return vc?.type === "pending-expand" ? undefined : vc;
}

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
      negation: field.negationDisplay,
      negationDescription: field.negationDescription,
      description: field.description,
      takesValue: field.type !== "boolean",
      valueType: field.type,
      required: field.required,
      // Mirror runtime: default `--no-<cliName>` is accepted unless the
      // user opted out via `negation: false` or a custom-string negation.
      defaultNegationAccepted:
        field.type === "boolean" && (field.negation === undefined || field.negation === true),
      valueCompletion: stripPendingExpand(resolveValueCompletion(field)),
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
      valueCompletion: stripPendingExpand(resolveValueCompletion(field)),
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
 * For boolean options, the runtime parser accepts the implicit
 * `--no-<cliName>` (and camelCase `--noCliName`) form unless the user
 * opted out via `negation: false` or supplied a custom-string negation
 * (which suppresses the default form). Aliases participate too: a
 * boolean with `alias: "c"` accepts `--no-c` / `--noC` because the
 * runtime resolves the post-`no-` segment through `aliasMap`. The
 * completion parser must mirror that so dynamic resolvers see the
 * correct flag state.
 */
function isImplicitBooleanNegation(opt: CompletableOption, nameOrAlias: string): boolean {
  if (opt.valueType !== "boolean") return false;
  if (opt.defaultNegationAccepted === false) return false;
  const candidates = [opt.cliName, ...(opt.alias ?? [])];
  for (const c of candidates) {
    const hyphenated = `no-${c}`;
    if (nameOrAlias === hyphenated) return true;
    if (nameOrAlias === toCamelCase(hyphenated)) return true;
  }
  return false;
}

/** Match by cliName, alias, camelCase variants, or an explicit negation name. */
function matchesExplicit(opt: CompletableOption, nameOrAlias: string): boolean {
  if (opt.cliName === nameOrAlias) return true;
  if (opt.alias?.includes(nameOrAlias)) return true;
  if (nameOrAlias.length <= 1) return false;
  if (opt.cliName.includes("-") && toCamelCase(opt.cliName) === nameOrAlias) return true;
  if (opt.alias?.some((a) => a.includes("-") && toCamelCase(a) === nameOrAlias)) return true;
  if (opt.negation) {
    if (opt.negation === nameOrAlias) return true;
    if (opt.negation.includes("-") && toCamelCase(opt.negation) === nameOrAlias) return true;
  }
  return false;
}

/**
 * Find option by name or alias. Tried in two passes so that a real field
 * literally named `noFoo` always wins over `--no-foo` being interpreted as
 * the implicit negation of a sibling `foo` field — the runtime parser
 * resolves the explicit field first as well.
 */
function findOption(
  options: CompletableOption[],
  nameOrAlias: string,
): CompletableOption | undefined {
  const explicit = options.find((opt) => matchesExplicit(opt, nameOrAlias));
  if (explicit) return explicit;
  return options.find((opt) => isImplicitBooleanNegation(opt, nameOrAlias));
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

  // Names of every option declared by the global schema, plus a per-frame
  // view filtered to those NOT shadowed by a local of the same cliName.
  // The unfiltered set is consulted on subcommand descent to migrate any
  // shadowed-global value from local `parsedArgs` into `globalParsedArgs`
  // — runtime's `scanForSubcommand` extracts these flags as globals when
  // they precede a subcommand (it only knows the global schema), so the
  // value must survive descent the same way. The filtered set is used at
  // write-time so that within a frame the unshadowed globals still go
  // straight to `globalParsedArgs` and shadowed ones land locally (where
  // runtime's leaf `separateGlobalArgs` lets the local win when no
  // further descent occurs).
  const globalOptionNames = new Set(globalOptions.map((g) => g.name));
  let unshadowedGlobalNames = new Set<string>();
  const refreshUnshadowedGlobalNames = (cmd: AnyCommand): void => {
    if (globalOptions.length === 0) {
      unshadowedGlobalNames = new Set();
      return;
    }
    const localCliNames = new Set(extractOptions(cmd).map((o) => o.cliName));
    unshadowedGlobalNames = new Set(
      globalOptions.filter((g) => !localCliNames.has(g.cliName)).map((g) => g.name),
    );
  };
  refreshUnshadowedGlobalNames(currentCommand);

  // Names of array options written in the current command frame. Used to
  // mirror the runtime's per-frame array semantics: the first `--arr v`
  // in a frame *replaces* any value inherited from the parent frame (the
  // runtime's shallow merge of `rawGlobalArgs`), while subsequent
  // `--arr v` in the same frame *append*. Cleared on every subcommand
  // descent below.
  let arraysSetInCurrentFrame = new Set<string>();

  /**
   * Mark the option's cliName plus every alias and (if present) negation
   * form as consumed. The negation shares the field's "used" slot so
   * typing either form filters both from subsequent suggestions.
   */
  const markUsed = (opt: CompletableOption): void => {
    usedOptions.add(opt.cliName);
    for (const a of opt.alias ?? []) usedOptions.add(a);
    if (opt.negation) usedOptions.add(opt.negation);
  };

  const recordOptionValue = (opt: CompletableOption, value: string): void => {
    const target = unshadowedGlobalNames.has(opt.name) ? globalParsedArgs : parsedArgs;
    if (opt.valueType === "array") {
      if (arraysSetInCurrentFrame.has(opt.name)) {
        const existing = target[opt.name];
        target[opt.name] = Array.isArray(existing) ? [...existing, value] : [value];
      } else {
        target[opt.name] = [value];
        arraysSetInCurrentFrame.add(opt.name);
      }
    } else {
      target[opt.name] = value;
    }
  };

  /**
   * Record a boolean flag the user typed. The positive form sets `true`;
   * the negation form (`--no-foo` or a custom `negationDisplay`) sets
   * `false`. Dynamic resolvers depend on these values to switch candidates
   * based on flag state, so the absence of a writer here used to hide
   * boolean siblings entirely.
   */
  const recordBooleanFlag = (opt: CompletableOption, nameOrAlias: string): void => {
    const target = unshadowedGlobalNames.has(opt.name) ? globalParsedArgs : parsedArgs;
    const matchesExplicitNegation =
      opt.negation !== undefined &&
      (opt.negation === nameOrAlias ||
        (opt.negation.includes("-") && toCamelCase(opt.negation) === nameOrAlias));
    const isNegation = matchesExplicitNegation || isImplicitBooleanNegation(opt, nameOrAlias);
    target[opt.name] = !isNegation;
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

    // Combined short boolean flags such as `-ab` ⇒ `-a -b`. The runtime
    // parser unpacks these; the completion parser must do the same so a
    // resolver sees both flags as set. Only attempted when every char in
    // the group resolves to a value-less option, otherwise the word is
    // ambiguous (`-cVALUE` syntax) and we fall through to the single-
    // char path below.
    if (
      !afterDoubleDash &&
      word.startsWith("-") &&
      !word.startsWith("--") &&
      word.length > 2 &&
      !word.includes("=")
    ) {
      const chars: string[] = Array.from(word.slice(1));
      const resolved: Array<CompletableOption | undefined> = chars.map((c) =>
        findOption(options, c),
      );
      const allBoolean = resolved.every((o) => o !== undefined && !o.takesValue);
      if (allBoolean) {
        for (let idx = 0; idx < chars.length; idx++) {
          const o = resolved[idx];
          if (!o) continue;
          markUsed(o);
          recordBooleanFlag(o, chars[idx]!);
        }
        i++;
        continue;
      }
    }

    // Skip options and their values (before "--")
    if (!afterDoubleDash && isOption(word)) {
      const optName = parseOptionName(word);
      const opt = findOption(options, optName);

      if (opt) {
        markUsed(opt);

        if (opt.takesValue) {
          if (hasInlineValue(word)) {
            const eqIdx = word.indexOf("=");
            recordOptionValue(opt, word.slice(eqIdx + 1));
          } else if (i + 1 < argv.length - 1) {
            const next = argv[i + 1]!;
            // Mirror the runtime parser (`parseArgv`): a token starting
            // with `-` is treated as the next option, not as this
            // option's value. Otherwise `--config --flag --field <TAB>`
            // records `config === "--flag"` and leaves `flag` unset,
            // so the resolver sees a state the runtime never produces.
            if (!isOption(next)) {
              recordOptionValue(opt, next);
              i++;
            }
          }
        } else {
          recordBooleanFlag(opt, optName);
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
      // Migrate any shadowed-global value the parent frame recorded
      // locally into `globalParsedArgs`. Runtime's `scanForSubcommand`
      // captured the same flag as a global token when it preceded this
      // descent (the scan only knows the global schema), so the value
      // must persist into the child the same way. The reverse direction
      // — moving an already-global value back to local — never applies
      // because the shadow check at write-time only put unshadowed
      // globals into `globalParsedArgs`.
      for (const key of Object.keys(parsedArgs)) {
        if (globalOptionNames.has(key)) {
          globalParsedArgs[key] = parsedArgs[key];
        }
      }
      refreshUnshadowedGlobalNames(currentCommand);
      usedOptions.clear(); // Reset for new subcommand
      positionalCount = 0;
      parsedArgs = {};
      positionalValues = [];
      // Mirror the runner's per-frame array semantics: keep the parent
      // frame's value as the inherited starting point (shallow merge
      // preserves it when the child doesn't redeclare). The "first set
      // in this frame replaces" rule is enforced by clearing the
      // per-frame seen-set instead of deleting the accumulator outright.
      arraysSetInCurrentFrame = new Set<string>();
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
      const store = unshadowedGlobalNames.has(targetOption.name) ? globalParsedArgs : parsedArgs;
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
