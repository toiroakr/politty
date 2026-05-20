/**
 * Parse completion context from partial command line
 */

import { extractFields, toCamelCase } from "../../core/schema-extractor.js";
import { resolveSubCommandAlias } from "../../executor/subcommand-router.js";
import { resolveSubCommandMeta } from "../../lazy.js";
import type { AnyCommand, ArgsSchema } from "../../types.js";
import { collectOptionTokens } from "../extractor.js";
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

/**
 * Build the CLI tokens an option is recognised by (`--cliName`,
 * `--long-alias`, `-x`). Wraps `collectOptionTokens` so collision
 * detection sees every spelling the runtime aliasMap accepts — including
 * the camelCase form of hyphenated names, without which a parent-frame
 * local that intercepts `--toBe` for a global `to-be` would silently
 * skip the migration loop.
 */
function optionTokenSet(opt: CompletableOption): Set<string> {
  return new Set(collectOptionTokens(opt.cliName, opt.alias));
}

/**
 * Find a global option whose CLI tokens overlap with `local`'s tokens.
 * Used at subcommand descent to migrate values the runtime's
 * `scanForSubcommand` would have routed to a global field even though
 * the completion parser stored them under a different-named local.
 */
function findGlobalByTokenCollision(
  globals: readonly CompletableOption[],
  local: CompletableOption,
): CompletableOption | undefined {
  const localTokens = optionTokenSet(local);
  for (const g of globals) {
    for (const t of optionTokenSet(g)) {
      if (localTokens.has(t)) return g;
    }
  }
  return undefined;
}

/**
 * Mirror runtime `scanForSubcommand`: walk argv from the start with the
 * global schema only, populating `globalParsedArgs` with the values the
 * runtime would have routed there before any subcommand is reached.
 *
 * Returns the set of global option names captured during this pre-scan.
 * Used at the first subcommand descent to skip the local→global token
 * migration for entries whose true value is already known here — a
 * value-taking global aliased the same as a parent-local boolean (for
 * example global `--profile`/`-p` and local boolean `alias: "p"`) would
 * otherwise have `true` written over the genuine `"prod"`.
 */
function parsePreSubGlobals(
  argv: string[],
  globalOptions: readonly CompletableOption[],
  globalParsedArgs: Record<string, unknown>,
): Set<string> {
  const captured = new Set<string>();
  if (globalOptions.length === 0) return captured;
  const writeGlobal = (opt: CompletableOption, value: string): void => {
    if (opt.valueType === "array") {
      const ex = globalParsedArgs[opt.name];
      globalParsedArgs[opt.name] = Array.isArray(ex) ? [...ex, value] : [value];
    } else {
      globalParsedArgs[opt.name] = value;
    }
    captured.add(opt.name);
  };
  let i = 0;
  while (i < argv.length - 1) {
    const word = argv[i]!;
    if (word === "--") break;
    if (!word.startsWith("-")) break;
    // Combined short flags (`-fg`) freeze runtime scanForSubcommand —
    // mirror that, otherwise pre-pass over-consumes tokens the runtime
    // would have left for the leaf parser.
    if (!word.startsWith("--") && word.length > 2) {
      const eqIdx = word.indexOf("=");
      const withoutDash = eqIdx >= 0 ? word.slice(1, eqIdx) : word.slice(1);
      if (withoutDash.length > 1) break;
    }
    const parsed = parseOption(word);
    const opt = globalOptions.find(
      (o) =>
        matchesExplicit(o, parsed.name, parsed.isLong) ||
        isImplicitBooleanNegation(o, parsed.name, parsed.isLong),
    );
    if (!opt) break;
    if (opt.takesValue) {
      if (hasInlineValue(word)) {
        const eqIdx = word.indexOf("=");
        writeGlobal(opt, word.slice(eqIdx + 1));
        i++;
      } else if (i + 1 < argv.length - 1) {
        const next = argv[i + 1]!;
        if (next.startsWith("-")) {
          i++;
          continue;
        }
        writeGlobal(opt, next);
        i += 2;
      } else {
        break;
      }
    } else {
      const matchesExplicitNegation =
        parsed.isLong &&
        opt.negation !== undefined &&
        (opt.negation === parsed.name || matchesCamelCase(opt.negation, parsed.name));
      const isNeg =
        matchesExplicitNegation || isImplicitBooleanNegation(opt, parsed.name, parsed.isLong);
      globalParsedArgs[opt.name] = !isNeg;
      captured.add(opt.name);
      i++;
    }
  }
  return captured;
}

/**
 * Reshape a value pulled from local storage so it matches the global's
 * declared shape before landing in `globalParsedArgs`. Without this,
 * migrating a local scalar into an array global would expose the
 * resolver to `parsedArgs.tags === "foo"` instead of `["foo"]` — a
 * state the runtime parser never produces.
 */
function adaptValueForGlobal(value: unknown, global: CompletableOption): unknown {
  if (global.valueType === "array") {
    if (Array.isArray(value)) return value;
    return [value];
  }
  // Runtime's argv parser uses last-wins for scalars, so picking the
  // final element matches what `parseArgv` would have produced when
  // multiple matching tokens reach the global scalar.
  if (Array.isArray(value)) return value.at(-1);
  return value;
}

/**
 * Append globals to local, preserving local-shadowing by list ORDER rather
 * than by exclusion. Keeping a global in the merged list — even when a
 * local declares the same `cliName` — lets a global's non-colliding tokens
 * (e.g. a `-e` alias the local does not redeclare) still resolve to the
 * global. `findOption` walks the list and returns the first match, so a
 * token the local actually owns still wins.
 */
function mergeGlobalOptions(
  local: CompletableOption[],
  globals: CompletableOption[],
): CompletableOption[] {
  if (globals.length === 0) return local;
  return [...local, ...globals];
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

interface ParsedOption {
  name: string;
  /** True when the user typed the long form (`--foo`), false for short (`-x`). */
  isLong: boolean;
}

/**
 * Parse option name from word, retaining the form the user typed so the
 * lookup can keep short-form (`-x`) and long-form (`--x`) matches in
 * separate token spaces — runtime negation, cliName, and multi-char
 * aliases only ever appear as long form.
 */
function parseOption(word: string): ParsedOption {
  if (word.startsWith("--")) {
    const withoutPrefix = word.slice(2);
    const eqIndex = withoutPrefix.indexOf("=");
    return { name: eqIndex >= 0 ? withoutPrefix.slice(0, eqIndex) : withoutPrefix, isLong: true };
  }
  if (word.startsWith("-")) {
    return { name: word.slice(1, 2), isLong: false };
  }
  return { name: word, isLong: true };
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
 * runtime resolves the post-`no-` segment through `aliasMap`. Implicit
 * negation is LONG-FORM only — `-no-c` is never an accepted negation —
 * so callers must say so via `isLong` to prevent a short option from
 * being read as a negation.
 */
function isImplicitBooleanNegation(opt: CompletableOption, name: string, isLong: boolean): boolean {
  if (!isLong) return false;
  if (opt.valueType !== "boolean") return false;
  if (opt.defaultNegationAccepted === false) return false;
  const candidates = [opt.cliName, ...(opt.alias ?? [])];
  for (const c of candidates) {
    const hyphenated = `no-${c}`;
    if (name === hyphenated) return true;
    if (name === toCamelCase(hyphenated)) return true;
  }
  return false;
}

/** True when `source` is hyphenated and its camelCase form equals `name`. */
function matchesCamelCase(source: string | undefined, name: string): boolean {
  return source !== undefined && source.includes("-") && toCamelCase(source) === name;
}

/**
 * Match by cliName, alias, camelCase variants, or an explicit negation
 * name. `isLong` separates the short (`-x`) and long (`--xxx`) token
 * spaces: cliNames and explicit negations are only valid as long form,
 * and aliases match their own length class (a 1-char alias only matches
 * short form because its token is `-x`).
 */
function matchesExplicit(opt: CompletableOption, name: string, isLong: boolean): boolean {
  // A single-character cliName / alias is reachable from BOTH `--x`
  // and `-x` at runtime — short form falls through `aliasMap` to the
  // canonical name, and long form lands in the same map. Multi-char
  // names are only invokable as long form.
  if (opt.cliName === name && (isLong || opt.cliName.length === 1)) return true;
  if (opt.alias) {
    for (const a of opt.alias) {
      if (a === name && (isLong || a.length === 1)) return true;
    }
  }
  // Custom negation names always belong to the long-form token space —
  // runtime only matches them via the `--<negation>` route.
  if (isLong && opt.negation === name) return true;
  if (!isLong || name.length <= 1) return false;
  if (matchesCamelCase(opt.cliName, name)) return true;
  if (opt.alias?.some((a) => matchesCamelCase(a, name))) return true;
  return matchesCamelCase(opt.negation, name);
}

/**
 * Find option by name or alias. Tried in two passes so that a real field
 * literally named `noFoo` always wins over `--no-foo` being interpreted as
 * the implicit negation of a sibling `foo` field — the runtime parser
 * resolves the explicit field first as well.
 *
 * Short-form precedence mirrors runtime's `separateGlobalArgs`: when a
 * global owns the `-x` alias and the local does NOT explicitly declare
 * `alias: "x"`, the global wins (a bare local `cliName: "x"` does not
 * register `x` in the local aliasMap). Long form keeps the local-first
 * order via the unshadowed merged list.
 */
function findOption(
  options: CompletableOption[],
  parsed: ParsedOption,
): CompletableOption | undefined {
  if (!parsed.isLong) {
    const localWithExplicitAlias = options.find(
      (opt) => opt.isGlobal !== true && opt.alias?.includes(parsed.name) === true,
    );
    if (localWithExplicitAlias) return localWithExplicitAlias;
    const global = options.find(
      (opt) => opt.isGlobal === true && matchesExplicit(opt, parsed.name, parsed.isLong),
    );
    if (global) return global;
  }
  const explicit = options.find((opt) => matchesExplicit(opt, parsed.name, parsed.isLong));
  if (explicit) return explicit;
  return options.find((opt) => isImplicitBooleanNegation(opt, parsed.name, parsed.isLong));
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

  // Tag every global-schema option with `isGlobal: true` so the
  // value-routing logic in `recordOptionValue` / `recordBooleanFlag` can
  // tell a global match apart from a same-shaped local match purely
  // through the option object, without re-scanning the global schema.
  const globalOptions: CompletableOption[] = globalArgsSchema
    ? extractOptionsFromSchema(globalArgsSchema).map((o) => ({ ...o, isGlobal: true }))
    : [];

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

  // Pre-scan pre-subcommand argv with the global-only schema. Mirrors
  // runtime `scanForSubcommand`, which routes pre-sub tokens to globals
  // even when a parent-local schema shadows the same alias. The migration
  // at first descent below skips any global name captured here so an
  // arity-mismatched local parse (boolean `-p` vs value-taking `-p`)
  // doesn't clobber the genuine global value.
  const globalsCapturedByPreSubScan = parsePreSubGlobals(argv, globalOptions, globalParsedArgs);

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
    const target = opt.isGlobal === true ? globalParsedArgs : parsedArgs;
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
  const recordBooleanFlag = (opt: CompletableOption, parsed: ParsedOption): void => {
    const target = opt.isGlobal === true ? globalParsedArgs : parsedArgs;
    const matchesExplicitNegation =
      parsed.isLong &&
      opt.negation !== undefined &&
      (opt.negation === parsed.name || matchesCamelCase(opt.negation, parsed.name));
    const isNegation =
      matchesExplicitNegation || isImplicitBooleanNegation(opt, parsed.name, parsed.isLong);
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
      // Runtime's global separation (`scanForSubcommand` /
      // `separateGlobalArgs`) does NOT decompose combined short flags
      // — only the leaf-level local parser does. Mirror that here by
      // matching each char against LOCAL options only and recording
      // every resolved boolean. A char that doesn't resolve locally
      // (or that maps to a value-taking option) is a no-op, just like
      // the runtime's `setOption` on an unknown short. Always consume
      // the whole combined word so the single-option branch below
      // does not misread `-ab` as `-a`.
      const localOptions = options.filter((o) => o.isGlobal !== true);
      for (const c of chars) {
        const o = findOption(localOptions, { name: c, isLong: false });
        if (!o || o.takesValue) continue;
        markUsed(o);
        recordBooleanFlag(o, { name: c, isLong: false });
      }
      i++;
      continue;
    }

    // Skip options and their values (before "--")
    if (!afterDoubleDash && isOption(word)) {
      const parsed = parseOption(word);
      const opt = findOption(options, parsed);

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
          recordBooleanFlag(opt, parsed);
        }
      }
      i++;
      continue;
    }

    // Check if this is a subcommand (before "--")
    const subcommand = afterDoubleDash ? null : resolveSubcommand(currentCommand, word);
    if (subcommand) {
      subcommandPath.push(word);
      // Capture the parent's local options BEFORE switching frames so
      // the migration loop below can resolve token collisions against
      // them; once `currentCommand` flips to the child we lose access
      // to the parent's schema.
      const parentLocalOptions = extractOptions(currentCommand);
      currentCommand = subcommand;
      options = mergeGlobalOptions(extractOptions(currentCommand), globalOptions);
      // Migrate values the parent frame recorded locally that the
      // runtime would have routed to a global instead. Runtime's
      // `scanForSubcommand` only knows the global schema and harvests
      // any flag matching a global token as global when it precedes a
      // descent, so two shapes of collision both need to migrate:
      //  - Same-name shadow: parent declares a local with the SAME
      //    field name as a global → write-time used the (unshadowed)
      //    local store; we migrate by field name here.
      //  - Token collision: parent's local shares a CLI token (alias,
      //    camelCase variant) with a global option of a DIFFERENT
      //    name → write-time still stored under the local's name, but
      //    the runtime would have surfaced the value as
      //    `globalArgs[globalOpt.name]`. Migrate to the global's name.
      const isFirstDescent = subcommandPath.length === 1;
      for (const key of Object.keys(parsedArgs)) {
        const localOpt = parentLocalOptions.find((o) => o.name === key);
        const sameNameGlobal = globalOptions.find((g) => g.name === key);
        const tokenCollidingGlobal =
          sameNameGlobal ??
          (localOpt ? findGlobalByTokenCollision(globalOptions, localOpt) : undefined);
        if (!tokenCollidingGlobal) continue;
        // At first descent, `parsePreSubGlobals` already wrote the
        // authoritative value parsed against the global schema. Don't
        // overwrite it with an arity-adapted local value.
        if (isFirstDescent && globalsCapturedByPreSubScan.has(tokenCollidingGlobal.name)) continue;
        globalParsedArgs[tokenCollidingGlobal.name] = adaptValueForGlobal(
          parsedArgs[key],
          tokenCollidingGlobal,
        );
      }
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
    const opt = findOption(options, parseOption(previousWord));
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
  // Case 2: Current word is an option with inline value (--foo= or -f=).
  // Runtime accepts both shapes; the generated bash script's pre-scan
  // already splits the short form for earlier words, and now the
  // option-value classifier matches it for the current word too.
  else if (!afterDoubleDash && currentWord.startsWith("-") && hasInlineValue(currentWord)) {
    const opt = findOption(options, parseOption(currentWord));
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
      const store = targetOption.isGlobal === true ? globalParsedArgs : parsedArgs;
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
