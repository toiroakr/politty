/**
 * Extract completion data from commands
 */

import { extractFields, type ResolvedFieldMeta } from "../core/schema-extractor.js";
import { resolveSubCommandMeta } from "../lazy.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import { resolveExpandTargets, type PendingExpandTarget } from "./expand-resolver.js";
import { aliasToken } from "./shell-shared.js";
import type {
  CompletableOption,
  CompletablePositional,
  CompletableSubcommand,
  CompletionData,
  ValueCompletion,
} from "./types.js";
import { resolveValueCompletion } from "./value-completion-resolver.js";

/**
 * Strip the transient `pending-expand` sentinel from a `resolveValueCompletion`
 * result. The static extractor stashes pending specs into a side-channel and
 * patches the resolved `ValueCompletion` onto the field after sibling
 * choices are known.
 */
function takeResolvedValueCompletion(
  field: ResolvedFieldMeta,
  pending: PendingExpandTarget[],
  describe: string,
  set: (vc: ValueCompletion) => void,
): ValueCompletion | undefined {
  const raw = resolveValueCompletion(field);
  if (raw?.type === "pending-expand") {
    pending.push({ name: field.name, describe, set, spec: raw.spec });
    return undefined;
  }
  return raw;
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
  const vc = takeResolvedValueCompletion(field, pending, `--${field.cliName}`, (next) => {
    opt.valueCompletion = next;
  });
  if (vc !== undefined) {
    opt.valueCompletion = vc;
  }
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
      const vc = takeResolvedValueCompletion(field, pending, `<${field.cliName}>`, (next) => {
        pos.valueCompletion = next;
      });
      if (vc !== undefined) {
        pos.valueCompletion = vc;
      }
      return pos;
    });
}

/**
 * Extract a completable subcommand from a command
 */
function extractSubcommand(name: string, command: AnyCommand): CompletableSubcommand {
  const subcommands: CompletableSubcommand[] = [];

  // Extract subcommands recursively (only sync subcommands for now)
  if (command.subCommands) {
    for (const [subName, subCommand] of Object.entries(command.subCommands)) {
      const resolved = resolveSubCommandMeta(subCommand);
      if (resolved) {
        subcommands.push(extractSubcommand(subName, resolved));
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
  // Resolve every `pending-expand` collected above against this subcommand's
  // siblings, producing `{ type: "expand", table, dependsOn }`
  // ValueCompletion entries. Throws if dependsOn references a non-static
  // sibling or `enumerate` raises.
  resolveExpandTargets(node, pending);
  return node;
}

/** Join parent and child with a separator, omitting separator when parent is empty. */
function joinPrefix(parent: string, child: string, sep: string): string {
  return parent ? `${parent}${sep}${child}` : child;
}

/**
 * Collect opt-takes-value case entries for a subcommand tree.
 * Used by bash and zsh generators (identical case syntax: `path:--opt) return 0 ;;`).
 * parentPath is a colon-delimited path (e.g., "" for root, "workspace:user" for nested).
 */
export function optTakesValueEntries(sub: CompletableSubcommand, parentPath: string): string[] {
  const lines: string[] = [];
  for (const opt of sub.options) {
    if (opt.takesValue) {
      const patterns = [
        `${parentPath}:--${opt.cliName}`,
        ...(opt.alias?.map((a) => `${parentPath}:${aliasToken(a)}`) ?? []),
      ];
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
 * Build the runtime token list used by shell scanners to recognise an option.
 * Long aliases get `--`, single-char aliases get `-`, mirroring the existing
 * tracker case patterns.
 */
function collectOptionTokens(cliName: string, aliases: readonly string[] | undefined): string[] {
  return [`--${cliName}`, ...(aliases?.map(aliasToken) ?? [])];
}

/**
 * Walk the subcommand tree and return every resolved expand spec along
 * with where it lives. The order is deterministic (DFS, root → leaves;
 * options before positionals within a node).
 */
export function collectExpandSpecs(root: CompletableSubcommand): ExpandSpecLocation[] {
  const out: ExpandSpecLocation[] = [];
  walk(root, [], [""], "root", out);
  return out;
}

function walk(
  node: CompletableSubcommand,
  path: string[],
  pathStrs: readonly string[],
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
        funcSuffix,
        fieldName: opt.name,
        isGlobal: opt.isGlobal === true,
        isPositional: false,
        isArrayOption,
        optionTokens: isArrayOption ? collectOptionTokens(opt.cliName, opt.alias) : [],
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
    const childNames = [child.name, ...(child.aliases ?? [])];
    const childPathStrs = pathStrs.flatMap((p) => childNames.map((n) => (p ? `${p}:${n}` : n)));
    const childFunc =
      funcSuffix === "root" ? sanitize(child.name) : `${funcSuffix}_${sanitize(child.name)}`;
    walk(child, childPath, childPathStrs, childFunc, out);
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
  const out: TrackedFieldRef[] = [];
  const seen = new Set<string>();
  const nodeByPath = indexNodesByPath(root);
  for (const spec of specs) {
    const node = nodeByPath.get(spec.pathStr);
    if (!node) continue;
    for (const dep of spec.vc.dependsOn) {
      const dedupKey = `${spec.pathStr}::${dep}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      // Global expand specs are resolved against the global siblings list
      // alone (see `resolveExpandTargets` in `extractCompletionData`), so
      // their dep tracker must reference the global option metadata even
      // when a subcommand later defines a local field with the same
      // name. Looking the dep up on `node.options` would silently rebind
      // the tracker to the local shadow.
      if (spec.isGlobal) {
        const globalOpt = globalOptions.find((o) => o.name === dep);
        if (globalOpt) {
          // Drop pathStrs where a subcommand defines a local option that
          // claims any of the global dep's CLI tokens. The runtime
          // parser routes by `cliName` / `alias`, not the field's
          // identifier, so a local option with a different field name
          // but the same `--env` flag still shadows the global at that
          // frame. Emitting the global tracker there would record the
          // local value into `_global_arg_values`.
          const globalTokens = new Set<string>([globalOpt.cliName, ...(globalOpt.alias ?? [])]);
          const activePathStrs = spec.pathStrs.filter((p) => {
            const n = nodeByPath.get(p);
            if (!n) return false;
            const localShadow = n.options.find(
              (o) =>
                o.isGlobal !== true &&
                (o.name === dep ||
                  globalTokens.has(o.cliName) ||
                  o.alias?.some((a) => globalTokens.has(a)) === true),
            );
            return !localShadow;
          });
          if (activePathStrs.length === 0) continue;
          out.push({
            fieldName: dep,
            isGlobal: true,
            pathStr: activePathStrs[0]!,
            pathStrs: activePathStrs,
            isPositional: false,
            optionTokens: collectOptionTokens(globalOpt.cliName, globalOpt.alias),
          });
        }
        continue;
      }
      const posIndex = node.positionals.findIndex((p) => p.name === dep);
      if (posIndex >= 0) {
        out.push({
          fieldName: dep,
          isGlobal: false,
          pathStr: spec.pathStr,
          pathStrs: spec.pathStrs,
          isPositional: true,
          position: posIndex,
        });
        continue;
      }
      const opt = node.options.find((o) => o.name === dep);
      if (opt) {
        out.push({
          fieldName: dep,
          isGlobal: opt.isGlobal === true,
          pathStr: spec.pathStr,
          pathStrs: spec.pathStrs,
          isPositional: false,
          optionTokens: collectOptionTokens(opt.cliName, opt.alias),
        });
      }
    }
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
      const childNames = [child.name, ...(child.aliases ?? [])];
      const childPathStrs = pathStrs.flatMap((p) => childNames.map((n) => (p ? `${p}:${n}` : n)));
      recurse(child, childPathStrs);
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
  const rootSubcommand = extractSubcommand(programName, command);

  // When globalArgsSchema is provided, derive global options from it
  // and merge them into all subcommands so shell generators include them at every level
  let globalOptions: CompletableOption[];
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
    // Merge global options into all subcommands recursively
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
