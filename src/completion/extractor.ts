/**
 * Extract completion data from commands
 */

import { extractFields, type ResolvedFieldMeta } from "../core/schema-extractor.js";
import { resolveSubCommandMeta } from "../lazy.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import { resolveExpandTargets, type PendingExpandTarget } from "./expand-resolver.js";
import { collectOptionTokens, globalShortTokens, localShadowingTokens } from "./shell-shared.js";
import type {
  CompletableOption,
  CompletablePositional,
  CompletableSubcommand,
  CompletionData,
  ValueCompletion,
} from "./types.js";
import { resolveValueCompletion } from "./value-completion-resolver.js";

/**
 * Resolve and assign value completion to a field. Pending expand sentinels
 * are stashed in `pending`; the eventual `resolveExpandTargets` pass replaces
 * the sentinel with a fully-resolved `{ type: "expand", ... }` via `set`.
 */
function assignValueCompletion(
  field: ResolvedFieldMeta,
  pending: PendingExpandTarget[],
  describe: string,
  set: (vc: ValueCompletion) => void,
): void {
  const raw = resolveValueCompletion(field);
  if (raw?.type === "pending-expand") {
    pending.push({ name: field.name, describe, set, spec: raw.spec });
    return;
  }
  if (raw !== undefined) set(raw);
}

/**
 * Sanitize a name for use as a shell function/variable identifier.
 * Replaces any character that is not alphanumeric or underscore with underscore.
 *
 * Note: This is not injective -- distinct names may produce the same output
 * (e.g., "foo-bar" and "foo_bar" both become "foo_bar"). When used for nested
 * path encoding (`path.map(sanitize).join("_")`), cross-level collisions are
 * theoretically possible (e.g., "foo-bar:baz" vs "foo:bar-baz") but extremely
 * unlikely in real CLI designs. If collision-safety is needed, sanitize must be
 * replaced with an injective encoding.
 */
export function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/**
 * Build the override env-var name shells inspect to pick a different
 * binary (`<NAME>_BIN`). Shell parameter names cannot begin with a
 * digit, so prepend an underscore when the upper-cased function name
 * starts with one — e.g. `2fa` ⇒ `_2FA_BIN`.
 */
export function binEnvVarName(fn: string): string {
  const upper = fn.toUpperCase();
  return /^[A-Z_]/.test(upper) ? `${upper}_BIN` : `_${upper}_BIN`;
}

/**
 * Filter subcommands to only visible (non-internal) ones.
 * Internal subcommands start with "__" and are hidden from completion/help.
 */
export function getVisibleSubs(subs: CompletableSubcommand[]): CompletableSubcommand[] {
  return subs.filter((s) => !s.name.startsWith("__"));
}

/**
 * Get all completable subcommand names including aliases.
 * Returns an array of { name, description } for all visible subcommands
 * and their aliases.
 */
export function getSubNamesWithAliases(
  subs: CompletableSubcommand[],
): Array<{ name: string; description?: string | undefined }> {
  const result: Array<{ name: string; description?: string | undefined }> = [];
  for (const sub of getVisibleSubs(subs)) {
    result.push({ name: sub.name, description: sub.description });
    if (sub.aliases) {
      for (const alias of sub.aliases) {
        result.push({ name: alias, description: sub.description });
      }
    }
  }
  return result;
}

/**
 * Convert a resolved field to a completable option. Pending expand specs
 * are stashed in `pending` and patched onto the returned object after
 * sibling choices are known.
 */
function fieldToOption(
  field: ResolvedFieldMeta,
  pending: PendingExpandTarget[],
): CompletableOption {
  // Runtime accepts the implicit `--no-<cliName>` form only when `negation`
  // is undefined or `true`. A custom-string or explicit `false` disables
  // the default form.
  const defaultNegationAccepted =
    field.type === "boolean" && (field.negation === undefined || field.negation === true);

  const opt: CompletableOption = {
    name: field.name,
    cliName: field.cliName,
    alias: field.alias,
    negation: field.negationDisplay,
    negationDescription: field.negationDescription,
    description: field.description,
    // Booleans are flags that don't require a value
    takesValue: field.type !== "boolean",
    valueType: field.type,
    required: field.required,
    defaultNegationAccepted,
  };
  assignValueCompletion(field, pending, `--${field.cliName}`, (next) => {
    opt.valueCompletion = next;
  });
  return opt;
}

/**
 * Extract options from a command's args schema
 */
function extractOptions(command: AnyCommand, pending: PendingExpandTarget[]): CompletableOption[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
  return extracted.fields
    .filter((field) => !field.positional) // Only include flags/options, not positionals
    .map((field) => fieldToOption(field, pending));
}

/**
 * Extract positional arguments from a command
 */
export function extractPositionals(command: AnyCommand): ResolvedFieldMeta[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
  return extracted.fields.filter((field) => field.positional);
}

/**
 * Extract completable positional arguments from a command.
 * Pending expand specs are stashed in `pending` for later resolution.
 */
function extractCompletablePositionals(
  command: AnyCommand,
  pending: PendingExpandTarget[],
): CompletablePositional[] {
  if (!command.args) {
    return [];
  }

  const extracted = extractFields(command.args);
  return extracted.fields
    .filter((field) => field.positional)
    .map((field, index): CompletablePositional => {
      const pos: CompletablePositional = {
        name: field.name,
        cliName: field.cliName,
        position: index,
        description: field.description,
        required: field.required,
        variadic: field.type === "array",
      };
      assignValueCompletion(field, pending, `<${field.cliName}>`, (next) => {
        pos.valueCompletion = next;
      });
      return pos;
    });
}

/**
 * Extract a completable subcommand from a command
 */
function extractSubcommand(
  name: string,
  command: AnyCommand,
  globalOptions: readonly CompletableOption[] = [],
): CompletableSubcommand {
  const subcommands: CompletableSubcommand[] = [];

  // Extract subcommands recursively (only sync subcommands for now)
  if (command.subCommands) {
    for (const [subName, subCommand] of Object.entries(command.subCommands)) {
      const resolved = resolveSubCommandMeta(subCommand);
      if (resolved) {
        subcommands.push(extractSubcommand(subName, resolved, globalOptions));
      } else {
        // Legacy async subcommands: placeholder only
        subcommands.push({
          name: subName,
          description: "(lazy loaded)",
          subcommands: [],
          options: [],
          positionals: [],
        });
      }
    }
  }

  const pending: PendingExpandTarget[] = [];
  const node: CompletableSubcommand = {
    name,
    description: command.description,
    aliases: command.aliases,
    subcommands,
    options: extractOptions(command, pending),
    positionals: extractCompletablePositionals(command, pending),
  };
  // Resolve every `pending-expand` collected above against this
  // subcommand's siblings (and the global schema, which runtime
  // propagates to every frame). Throws if `dependsOn` references a
  // non-static sibling or `enumerate` raises.
  resolveExpandTargets(node, pending, globalOptions);
  return node;
}

/** Join parent and child with a separator, omitting separator when parent is empty. */
function joinPrefix(parent: string, child: string, sep: string): string {
  return parent ? `${parent}${sep}${child}` : child;
}

/**
 * Expand each parent pathStr by joining every child name (canonical plus
 * aliases) with `:`. Used to keep alias-expanded path variants in lockstep
 * across walkers that need to reach the same node from any path the
 * runtime scanner can produce.
 */
function expandChildPathStrs(pathStrs: readonly string[], child: CompletableSubcommand): string[] {
  const childNames = [child.name, ...(child.aliases ?? [])];
  return pathStrs.flatMap((p) => childNames.map((n) => (p ? `${p}:${n}` : n)));
}

/**
 * Collect opt-takes-value case entries for a subcommand tree.
 * Used by bash and zsh generators (identical case syntax: `path:--opt) return 0 ;;`).
 * parentPath is a colon-delimited path (e.g., "" for root, "workspace:user" for nested).
 */
export function optTakesValueEntries(sub: CompletableSubcommand, parentPath: string): string[] {
  const lines: string[] = [];
  const isAncestor = getVisibleSubs(sub.subcommands).length > 0;
  for (const opt of sub.options) {
    if (opt.takesValue) {
      // Reuse the full token set used by tracker emission so the
      // takes-value lookup table accepts every form runtime's aliasMap
      // does (1-char cliName `-x`, 1-char alias long form `--f`,
      // camelCase variants of hyphenated names). Without this the
      // scanner skips the value of a valid option spelling.
      //
      // At ANCESTOR frames (frames with further subcommand children),
      // the runtime's `scanForSubcommand` routes pre-sub tokens with
      // the global schema only — local-precedence does NOT apply, so a
      // global value option keeps every alias even when a local at the
      // frame claims the same short token. At LEAF frames, the leaf
      // parser's `separateGlobalArgs` applies local-precedence so the
      // filter via `effectiveOptionTokens` is correct.
      const tokens =
        isAncestor && opt.isGlobal === true
          ? collectOptionTokens(opt.cliName, opt.alias)
          : effectiveOptionTokens(opt, sub.options);
      if (tokens.length === 0) continue;
      const patterns = tokens.map((t) => `${parentPath}:${t}`);
      lines.push(`        ${patterns.join("|")}) return 0 ;;`);
    }
  }
  for (const child of getVisibleSubs(sub.subcommands)) {
    lines.push(...optTakesValueEntries(child, joinPrefix(parentPath, child.name, ":")));
    // Also generate opt-takes-value entries under alias paths
    if (child.aliases) {
      for (const alias of child.aliases) {
        lines.push(...optTakesValueEntries(child, joinPrefix(parentPath, alias, ":")));
      }
    }
  }
  return lines;
}

/**
 * Route entry for subcommand dispatch.
 * - pathStr: colon-delimited path (e.g., "config:user:get")
 * - funcSuffix: sanitized function suffix (e.g., "config_user_get")
 * - lookupPattern: "parentPath:childName" for is_subcmd matching (e.g., "config:user:get", or ":config" for root-level)
 */
export interface RouteEntry {
  pathStr: string;
  funcSuffix: string;
  lookupPattern: string;
}

/**
 * Recursively collect all subcommand route entries.
 * Returns entries used by all shell generators for both dispatch routing
 * and subcommand lookup (is_subcmd) tables.
 * Aliases are mapped to the same handler as the canonical name.
 */
export function collectRouteEntries(
  sub: CompletableSubcommand,
  parentPath = "",
  parentFunc = "",
): RouteEntry[] {
  const entries: RouteEntry[] = [];
  for (const child of getVisibleSubs(sub.subcommands)) {
    const pathStr = joinPrefix(parentPath, child.name, ":");
    const funcSuffix = joinPrefix(parentFunc, sanitize(child.name), "_");
    entries.push(...collectRouteEntries(child, pathStr, funcSuffix));
    entries.push({
      pathStr,
      funcSuffix,
      lookupPattern: `${parentPath}:${child.name}`,
    });
    // Add alias route entries that map to the same handler,
    // including descendant routes so nested completion works via alias paths
    if (child.aliases) {
      for (const alias of child.aliases) {
        const aliasPathStr = joinPrefix(parentPath, alias, ":");
        // Recurse into descendants using alias path but same funcSuffix
        entries.push(...collectRouteEntries(child, aliasPathStr, funcSuffix));
        entries.push({
          pathStr: aliasPathStr,
          funcSuffix,
          lookupPattern: `${parentPath}:${alias}`,
        });
      }
    }
  }
  return entries;
}

/**
 * Generate is_subcmd case/switch body lines (bash/zsh case syntax).
 * Returns lines for the case statement body only (caller wraps in function).
 */
export function isSubcmdCaseLines(routeEntries: RouteEntry[]): string[] {
  return routeEntries.map((r) => `        ${r.lookupPattern}) return 0 ;;`);
}

/**
 * Subcommand-dispatch case body lines for bash/zsh: each route forwards
 * `$_subcmd` to its handler function. Identical emission between shells.
 */
export function subDispatchCaseLines(routeEntries: RouteEntry[], fn: string): string[] {
  return routeEntries.map((r) => `        ${r.pathStr}) __${fn}_complete_${r.funcSuffix} ;;`);
}

/**
 * Per-shell `_arg_values` write expression. zsh uses an associative-array
 * subscript; bash uses prefix-scalar variables so the generated script
 * runs on bash 3.2 (macOS default `/bin/bash`), which lacks associative
 * arrays. The `isGlobal` flag picks the bucket (`_global_arg_values_*`
 * survives subcommand descent; `_arg_values_*` does not).
 */
function trackedFieldAssign(
  t: Pick<TrackedFieldRef, "fieldName" | "isGlobal">,
  shell: "bash" | "zsh",
): string {
  const prefix = t.isGlobal ? `_global_arg_values` : `_arg_values`;
  return shell === "bash"
    ? `${prefix}_${sanitize(t.fieldName)}="$3"`
    : `${prefix}[${t.fieldName}]="$3"`;
}

/**
 * Case-statement body lines for `__track_opt` — capture option values into
 * the per-frame state. See {@link trackedFieldAssign} for the per-shell
 * assignment shape.
 */
export function trackOptCaseLines(
  trackedFields: readonly TrackedFieldRef[],
  shell: "bash" | "zsh",
): string[] {
  const lines: string[] = [];
  for (const t of trackedFields) {
    if (t.isPositional || !t.optionTokens || t.optionTokens.length === 0) continue;
    const joined = t.pathStrs.flatMap((p) => t.optionTokens!.map((n) => `${p}:${n}`)).join("|");
    lines.push(`        ${joined}) ${trackedFieldAssign(t, shell)} ;;`);
  }
  return lines;
}

/**
 * Case-statement body lines for `__track_pos` — capture positional values
 * by `(subcmd, positional-index)`. See {@link trackedFieldAssign} for the
 * per-shell assignment shape.
 */
export function trackPosCaseLines(
  trackedFields: readonly TrackedFieldRef[],
  shell: "bash" | "zsh",
): string[] {
  const lines: string[] = [];
  for (const t of trackedFields) {
    if (!t.isPositional) continue;
    const joined = t.pathStrs.map((p) => `${p}:${t.position}`).join("|");
    lines.push(`        ${joined}) ${trackedFieldAssign(t, shell)} ;;`);
  }
  return lines;
}

/**
 * Case-statement body lines for `__track_array_expand` — record each `key=`
 * slot the user has typed so the candidate loop can skip already-consumed
 * entries. The first write to a global array in a frame replaces the
 * inherited bucket (mirroring the runtime's per-frame array merge);
 * subsequent writes append. zsh uses associative arrays; bash uses
 * prefix-scalar variables (see {@link trackOptCaseLines}).
 */
export function trackArrayExpandCaseLines(
  arrayExpandSpecs: readonly ExpandSpecLocation[],
  shell: "bash" | "zsh",
): string[] {
  const lines: string[] = [];
  for (const spec of arrayExpandSpecs) {
    if (spec.optionTokens.length === 0) continue;
    const joined = spec.pathStrs
      .flatMap((p) => spec.optionTokens.map((tok) => `${p}:${tok}`))
      .join("|");
    const bucket = sanitize(spec.fieldName);
    const bucketPrefix = spec.isGlobal ? `_global_used_field_keys` : `_used_field_keys`;
    // Bash 3.2 has no associative arrays; both shells happen to share
    // the +=/=" $_k "  append/replace syntax, so only the variable shape
    // differs.
    const bucketRef = shell === "bash" ? `${bucketPrefix}_${bucket}` : `${bucketPrefix}[${bucket}]`;
    const seenRef = shell === "bash" ? `_global_arr_seen_${bucket}` : `_global_arr_seen[${bucket}]`;
    const assignFirst = `${bucketRef}=" $_k "`;
    const assignAppend = `${bucketRef}+=" $_k "`;
    const seenSet = `${seenRef}=1`;
    lines.push(`        ${joined})`);
    lines.push(`            if [[ "$3" == *=* ]]; then`);
    lines.push(`                local _k="\${3%%=*}"`);
    if (spec.isGlobal) {
      lines.push(`                if [[ -n "$_k" ]]; then`);
      lines.push(`                    if [[ -z "\${${seenRef}:-}" ]]; then`);
      lines.push(`                        ${assignFirst}`);
      lines.push(`                        ${seenSet}`);
      lines.push(`                    else`);
      lines.push(`                        ${assignAppend}`);
      lines.push(`                    fi`);
      lines.push(`                fi`);
    } else {
      lines.push(`                [[ -n "$_k" ]] && ${assignAppend}`);
    }
    lines.push(`            fi`);
    lines.push(`            ;;`);
  }
  return lines;
}

/**
 * Location of a resolved expand-completion spec inside the command tree.
 * Emitted by {@link collectExpandSpecs}; shell generators use it to name
 * the hoisted table variable and to scope the tracker entries.
 */
export interface ExpandSpecLocation {
  /** Subcommand path from root (e.g., ["api"]). Empty array = root. */
  readonly path: readonly string[];
  /**
   * Colon-delimited canonical subcommand path used for case-statement matching
   * (e.g., "" for root, "api" for one level, "workspace:user" for nested).
   * For shell-side `case $_subcmd` emissions that must match the path the
   * user actually typed (including alias names), iterate over {@link pathStrs}
   * instead — they enumerate the canonical path plus every alias-expanded
   * variant.
   */
  readonly pathStr: string;
  /**
   * Canonical path plus all alias-expanded variants. The first element is
   * {@link pathStr}. Shell scanners need every variant when emitting tracker
   * `case` patterns: `$_subcmd` reflects the path-as-typed, so an alias
   * route like `a:GetApplication` must match alongside `api:GetApplication`.
   */
  readonly pathStrs: readonly string[];
  /**
   * Ancestor subcommand paths (canonical + alias variants) above this
   * spec's host frame. Used to emit global dep trackers at every
   * "before subcommand boundary" position: the runtime scanner collects
   * matching global tokens at every frame on the way down regardless of
   * the local schema, so a global dep value typed at any ancestor must
   * still feed this spec's lookup. Empty when the spec lives at the
   * root.
   */
  readonly intermediatePathStrs: readonly string[];
  /**
   * Function suffix used in `__<fn>_<funcSuffix>` naming (e.g., "api",
   * "workspace_user"; "root" for the root command).
   */
  readonly funcSuffix: string;
  /** Field name (camelCase) of the option/positional that has the expand spec. */
  readonly fieldName: string;
  /**
   * True when the host field comes from `globalArgsSchema`. Shell
   * generators store the array-dedup bucket in a global state so the
   * already-consumed keys survive subcommand descent — matching how the
   * runtime parser keeps global option values visible across frames.
   */
  readonly isGlobal: boolean;
  /** Whether the field is a positional argument. */
  readonly isPositional: boolean;
  /**
   * True when the host field is a repeatable array option. Shell generators
   * use this to enable runtime deduplication: as the user repeats the option
   * (e.g. `-f workspaceId=foo -f <TAB>`), already-used `key=` candidates are
   * filtered out. Always false for positionals (where repetition is variadic
   * and `key=value` semantics don't apply).
   */
  readonly isArrayOption: boolean;
  /**
   * Option tokens (`--cliName`, `-a`, `--long-alias`) used by the shell
   * scanner to recognise this option's values and update the dedup bucket.
   * Empty when `isArrayOption` is false.
   */
  readonly optionTokens: readonly string[];
  /** The resolved expand spec on this field. */
  readonly vc: Extract<ValueCompletion, { type: "expand" }>;
}

/**
 * Compute the option token set the runtime would actually route to
 * `opt` at the given frame. Globals shadow LOCAL short tokens of the
 * same letter (runtime's `separateGlobalArgs` harvests `-x` for the
 * global unless the local explicitly declares `alias: "x"`), so a
 * local cliName `x` with no alias must NOT emit `-x` in its
 * tracker / value-completion / takes-value cases when a global at the
 * frame owns that token. Long forms are unaffected — precedence is
 * scoped to short aliases.
 */
export function effectiveOptionTokens(
  opt: CompletableOption,
  frameOptions: readonly CompletableOption[],
): string[] {
  const all = collectOptionTokens(opt.cliName, opt.alias);
  if (opt.isGlobal === true) {
    // Tokens any local at the frame owns are routed by
    // `separateGlobalArgs` to the local, never to the global. Pull the
    // full owned spelling set via `localShadowingTokens` so a local
    // `alias: "e"` (which owns both `-e` and `--e`) excludes both forms
    // from the global's value-completion case, not just one.
    const localClaimed = new Set<string>();
    for (const o of frameOptions) {
      if (o.isGlobal === true) continue;
      for (const t of localShadowingTokens(o.cliName, o.alias)) localClaimed.add(t);
    }
    return all.filter((t) => !localClaimed.has(t));
  }
  const globalShort = globalShortTokens(frameOptions);
  if (globalShort.size === 0) return all;
  return all.filter((t) => {
    if (!t.startsWith("-") || t.startsWith("--")) return true;
    if (!globalShort.has(t)) return true;
    // Keep if the local explicitly declares the matching short alias.
    return opt.alias?.includes(t.slice(1)) === true;
  });
}

/**
 * Walk the subcommand tree and return every resolved expand spec along
 * with where it lives. The order is deterministic (DFS, root → leaves;
 * options before positionals within a node).
 */
export function collectExpandSpecs(root: CompletableSubcommand): ExpandSpecLocation[] {
  const out: ExpandSpecLocation[] = [];
  walk(root, [], [""], [], "root", out);
  return out;
}

function walk(
  node: CompletableSubcommand,
  path: string[],
  pathStrs: readonly string[],
  intermediatePathStrs: readonly string[],
  funcSuffix: string,
  out: ExpandSpecLocation[],
): void {
  const pathStr = pathStrs[0]!;
  for (const opt of node.options) {
    const vc = opt.valueCompletion;
    if (vc?.type === "expand") {
      const isArrayOption = opt.valueType === "array";
      out.push({
        path,
        pathStr,
        pathStrs,
        intermediatePathStrs,
        funcSuffix,
        fieldName: opt.name,
        isGlobal: opt.isGlobal === true,
        isPositional: false,
        isArrayOption,
        optionTokens: isArrayOption ? effectiveOptionTokens(opt, node.options) : [],
        vc,
      });
    }
  }
  for (const pos of node.positionals) {
    const vc = pos.valueCompletion;
    if (vc?.type === "expand") {
      out.push({
        path,
        pathStr,
        pathStrs,
        intermediatePathStrs,
        funcSuffix,
        fieldName: pos.name,
        isGlobal: false,
        isPositional: true,
        isArrayOption: false,
        optionTokens: [],
        vc,
      });
    }
  }
  for (const child of getVisibleSubs(node.subcommands)) {
    const childPath = [...path, child.name];
    const childPathStrs = expandChildPathStrs(pathStrs, child);
    // Pass the current frame's pathStrs (canonical + alias variants)
    // down as ancestor pathStrs for descendants. The descendant spec
    // uses these to emit global-dep tracker cases at every "before
    // subcommand boundary" position the runtime scanner can reach.
    const childIntermediates = [...intermediatePathStrs, ...pathStrs];
    const childFunc =
      funcSuffix === "root" ? sanitize(child.name) : `${funcSuffix}_${sanitize(child.name)}`;
    walk(child, childPath, childPathStrs, childIntermediates, childFunc, out);
  }
}

/**
 * Per-path information about a sibling field that an expand spec depends
 * on. Shell generators use this to populate `_arg_values` during the main
 * scan loop.
 */
export interface TrackedFieldRef {
  /** camelCase field name; used as the `_arg_values` map key. */
  readonly fieldName: string;
  /**
   * True when the underlying option is a global (propagated from
   * `globalArgsSchema`). Shell generators route global trackers into a
   * separate bucket that is not cleared on subcommand descent — matching
   * the runtime parser's behaviour of keeping globals visible from any
   * frame.
   */
  readonly isGlobal: boolean;
  /** Canonical subcommand path where this field lives. */
  readonly pathStr: string;
  /**
   * Canonical path plus all alias-expanded variants. The first element is
   * {@link pathStr}. Shell tracker emitters iterate over every variant so
   * `$_subcmd` matches whether the user typed the canonical or an alias.
   */
  readonly pathStrs: readonly string[];
  /** True if positional, false if option. */
  readonly isPositional: boolean;
  /** 0-based positional index (positional only). */
  readonly position?: number;
  /**
   * CLI tokens this option is recognised by (`--cliName`, `--long-alias`,
   * `-x`). Option only; empty for positionals. Emit-ready: shell tracker
   * generators concatenate these with the per-path prefix to produce case
   * patterns. Use {@link aliasToken} via {@link collectOptionTokens} so
   * single-char aliases keep their `-` prefix.
   */
  readonly optionTokens?: readonly string[];
}

/**
 * For every expand spec, find each `dependsOn` sibling field at the same
 * path and return enough metadata for the shell generator to emit tracker
 * cases. Fields that cannot be resolved are silently skipped — the static
 * extractor already validated `dependsOn` upstream in
 * `resolveExpandTargets`, so unresolved siblings here would indicate a
 * programming error and would simply yield no tracker entries.
 */
export function collectTrackedFields(
  root: CompletableSubcommand,
  specs: readonly ExpandSpecLocation[],
  globalOptions: readonly CompletableOption[] = [],
): TrackedFieldRef[] {
  const nodeByPath = indexNodesByPath(root);
  // Aggregate per (fieldName, isGlobal, isPositional, position) — multiple
  // specs may share the same dep (e.g. the same global dep referenced from
  // root, parent, and parent:child specs). Unioning their pathStrs into a
  // single case branch keeps the generated `__track_opt` body free of
  // duplicate patterns while preserving every frame the runtime scanner can
  // reach.
  interface Bucket {
    ref: Omit<TrackedFieldRef, "pathStr" | "pathStrs">;
    pathStrs: string[];
    seen: Set<string>;
  }
  const buckets = new Map<string, Bucket>();
  const addPath = (key: string, ref: Bucket["ref"], paths: readonly string[]): void => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { ref, pathStrs: [], seen: new Set() };
      buckets.set(key, bucket);
    }
    for (const p of paths) {
      if (bucket.seen.has(p)) continue;
      bucket.seen.add(p);
      bucket.pathStrs.push(p);
    }
  };

  /**
   * Group spec frames by the per-leaf surviving-token set for a global option.
   * The runtime scanner at a LEAF frame drops global tokens that a local
   * option already claims (via `localShadowingTokens`); at ANCESTOR frames it
   * sees only globals so every token survives. Grouping by token-set keeps the
   * generated tracker case body minimal — one branch per unique frame group.
   */
  const groupGlobalFramesByTokenSet = (
    optTokens: readonly string[],
    leafPaths: readonly string[],
    ancestorPaths: readonly string[],
  ): Map<string, { tokens: readonly string[]; paths: string[] }> => {
    const groups = new Map<string, { tokens: readonly string[]; paths: string[] }>();
    const recordLeaf = (path: string, tokens: readonly string[]): void => {
      if (tokens.length === 0) return;
      const tokenKey = tokens.join(" ");
      let group = groups.get(tokenKey);
      if (!group) {
        group = { tokens, paths: [] };
        groups.set(tokenKey, group);
      }
      group.paths.push(path);
    };
    for (const p of leafPaths) {
      const n = nodeByPath.get(p);
      if (!n) continue;
      // Use only the tokens the runtime's `separateGlobalArgs` would treat
      // as locally-owned at this leaf: the long-form cliName and every
      // EXPLICIT alias. A bare 1-char cliName does NOT register in the
      // local aliasMap unless an explicit `alias: "x"` is declared.
      const claimed = new Set<string>();
      for (const o of n.options) {
        if (o.isGlobal === true) continue;
        for (const t of localShadowingTokens(o.cliName, o.alias)) claimed.add(t);
      }
      recordLeaf(
        p,
        optTokens.filter((t) => !claimed.has(t)),
      );
    }
    // Intermediate frames always carry every global token: the runtime
    // scanner at those frames does not consult any local schema, so the
    // value always lands in `_global_arg_values` there.
    for (const p of ancestorPaths) recordLeaf(p, optTokens);
    return groups;
  };

  const addGlobalDepTracker = (
    dep: string,
    opt: CompletableOption,
    spec: ExpandSpecLocation,
  ): void => {
    const allTokens = collectOptionTokens(opt.cliName, opt.alias);
    const groups = groupGlobalFramesByTokenSet(allTokens, spec.pathStrs, spec.intermediatePathStrs);
    for (const [tokenKey, group] of groups) {
      addPath(
        `g::${dep}::${tokenKey}`,
        {
          fieldName: dep,
          isGlobal: true,
          isPositional: false,
          optionTokens: group.tokens,
        },
        group.paths,
      );
    }
  };

  for (const spec of specs) {
    const node = nodeByPath.get(spec.pathStr);
    if (!node) continue;
    for (const dep of spec.vc.dependsOn) {
      // Global expand specs are resolved against the global siblings list
      // alone (see `resolveExpandTargets` in `extractCompletionData`), so
      // their dep tracker must reference the global option metadata even
      // when a subcommand later defines a local field with the same
      // name. Looking the dep up on `node.options` would silently rebind
      // the tracker to the local shadow.
      if (spec.isGlobal) {
        const globalOpt = globalOptions.find((o) => o.name === dep);
        if (!globalOpt) continue;
        addGlobalDepTracker(dep, globalOpt, spec);
        continue;
      }
      const posIndex = node.positionals.findIndex((p) => p.name === dep);
      if (posIndex >= 0) {
        const key = `lp::${spec.pathStr}::${dep}`;
        addPath(
          key,
          {
            fieldName: dep,
            isGlobal: false,
            isPositional: true,
            position: posIndex,
          },
          spec.pathStrs,
        );
        continue;
      }
      const opt = node.options.find((o) => o.name === dep);
      if (!opt) continue;
      if (opt.isGlobal === true) {
        // Local expand depending on a propagated global tracks at the host
        // frame AND every ancestor the scanner crosses. The leaf frame may
        // have a local option whose emitted token shadows one of the
        // global's aliases — but that shadow does NOT apply at ancestor
        // frames, where the runtime scanner sees only globals.
        addGlobalDepTracker(dep, opt, spec);
        continue;
      }
      // A local dep tracker stays bound to the host frame: locals don't
      // propagate across subcommand boundaries the way globals do.
      addPath(
        `lo::${spec.pathStr}::${dep}`,
        {
          fieldName: dep,
          isGlobal: false,
          isPositional: false,
          optionTokens: effectiveOptionTokens(opt, node.options),
        },
        spec.pathStrs,
      );
    }
  }
  const out: TrackedFieldRef[] = [];
  for (const bucket of buckets.values()) {
    if (bucket.pathStrs.length === 0) continue;
    out.push({
      ...bucket.ref,
      pathStr: bucket.pathStrs[0]!,
      pathStrs: bucket.pathStrs,
    });
  }
  return out;
}

function indexNodesByPath(root: CompletableSubcommand): Map<string, CompletableSubcommand> {
  const map = new Map<string, CompletableSubcommand>();
  // Walk with all alias-expanded path variants so the same node is
  // reachable by every path the runtime scanner can produce (`d:Get`
  // alongside `deploy:Get`). Without alias paths in the index, callers
  // that look a node up by `$_subcmd` would miss the aliased frames.
  const recurse = (node: CompletableSubcommand, pathStrs: readonly string[]): void => {
    for (const p of pathStrs) map.set(p, node);
    for (const child of getVisibleSubs(node.subcommands)) {
      recurse(child, expandChildPathStrs(pathStrs, child));
    }
  };
  recurse(root, [""]);
  return map;
}

/**
 * Walk a CompletableSubcommand tree and return true when any option or
 * positional uses an in-process dynamic resolver. Used by shell generators
 * to decide whether to emit `__<fn>_invoke_complete` delegate helpers.
 */
export function hasDynamicCompletion(sub: CompletableSubcommand): boolean {
  for (const opt of sub.options) {
    if (opt.valueCompletion?.type === "dynamic") return true;
  }
  for (const pos of sub.positionals) {
    if (pos.valueCompletion?.type === "dynamic") return true;
  }
  for (const child of sub.subcommands) {
    if (hasDynamicCompletion(child)) return true;
  }
  return false;
}

/**
 * Recursively merge global options into a subcommand and all its descendants.
 * Avoids duplicates by checking existing option names.
 */
function propagateGlobalOptions(
  sub: CompletableSubcommand,
  globalOptions: CompletableOption[],
): void {
  const existingNames = new Set(sub.options.map((o) => o.name));
  const newOpts = globalOptions.filter((o) => !existingNames.has(o.name));
  sub.options = [...sub.options, ...newOpts];
  for (const child of sub.subcommands) {
    propagateGlobalOptions(child, globalOptions);
  }
}

/**
 * Extract completion data from a command tree
 *
 * @param command - The root command
 * @param programName - Program name for completion scripts
 * @param globalArgsSchema - Optional global args schema. When provided, global options
 *   are derived from this schema instead of the root command's options.
 */
export function extractCompletionData(
  command: AnyCommand,
  programName: string,
  globalArgsSchema?: ArgsSchema,
): CompletionData {
  // Derive globals FIRST so they're available when subcommand expand
  // specs resolve. A local expand that declares `dependsOn: ["env"]`
  // against a global \`env\` field would otherwise fail with a "not a
  // sibling" error at codegen time — runtime propagates the global to
  // every frame, so the resolved table needs to cover those keys too.
  let globalOptions: CompletableOption[] = [];
  if (globalArgsSchema) {
    const globalExtracted = extractFields(globalArgsSchema);
    const globalPending: PendingExpandTarget[] = [];
    globalOptions = globalExtracted.fields
      .filter((field) => !field.positional)
      .map((field) => {
        const opt = fieldToOption(field, globalPending);
        opt.isGlobal = true;
        return opt;
      });
    // Resolve `expand` specs on global options against the globals themselves
    // (globals can depend on other globals but not on subcommand-local args).
    resolveExpandTargets(
      {
        name: programName,
        subcommands: [],
        options: globalOptions,
        positionals: [],
      },
      globalPending,
    );
  }

  const rootSubcommand = extractSubcommand(programName, command, globalOptions);

  if (globalArgsSchema) {
    // Merge global options into all subcommands recursively so shell
    // generators include them at every level.
    propagateGlobalOptions(rootSubcommand, globalOptions);
  } else {
    // Default: global options are the options defined on the root command
    globalOptions = rootSubcommand.options;
  }

  return {
    command: rootSubcommand,
    programName,
    globalOptions,
  };
}
