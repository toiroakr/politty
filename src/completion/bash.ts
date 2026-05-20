/**
 * Bash completion script generator (static)
 *
 * Generates a self-contained bash completion script that embeds all
 * completion metadata. No Node.js process is spawned on TAB.
 */

import type { AnyCommand } from "../types.js";
import { CompletionDirective } from "./dynamic/candidate-generator.js";
import {
  binEnvVarName,
  collectExpandSpecs,
  collectOptionTokens,
  collectRouteEntries,
  collectTrackedFields,
  extractCompletionData,
  getSubNamesWithAliases,
  getVisibleSubs,
  hasDynamicCompletion,
  isSubcmdCaseLines,
  optTakesValueEntries,
  sanitize,
  subDispatchCaseLines,
  trackArrayExpandCaseLines,
  trackOptCaseLines,
  trackPosCaseLines,
} from "./extractor.js";
import {
  ansiC,
  quotedAvailabilityTokens,
  resolveExpandDepGlobality,
  type ResolvedExpandDep,
} from "./shell-shared.js";
import type {
  CompletableOption,
  CompletablePositional,
  CompletableSubcommand,
  CompletionOptions,
  CompletionResult,
  ValueCompletion,
} from "./types.js";

/** Escape a string for use inside bash double-quotes */
function escapeBashDQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

/**
 * Variable-name base for the expand entries of a (funcSuffix, fieldName).
 * Each emitted entry appends `__<encKey>` (see {@link bashEncodeKey}).
 */
function bashExpandVar(fn: string, funcSuffix: string, fieldName: string): string {
  return `__${fn}_expand_${funcSuffix}__${sanitize(fieldName)}`;
}

/**
 * Hex-encode any character outside `[A-Za-z0-9]` as `_HH` so the
 * resulting string is safe as a suffix of a bash identifier. `_` is also
 * encoded (as `_5F`) to keep the join separator between encoded dep
 * values unambiguous — without that, `(v1="-", v2="")` and
 * `(v1="_2D", v2="")` would both render `_2D_`. Mirrors the runtime
 * `__<fn>_enc` helper emitted alongside expand tables.
 */
function bashEncodeKey(s: string): string {
  let out = "";
  for (const ch of s) {
    if (/[A-Za-z0-9]/.test(ch)) {
      out += ch;
    } else {
      const code = ch.codePointAt(0)!;
      out += `_${code.toString(16).toUpperCase().padStart(2, "0")}`;
    }
  }
  return out;
}

interface BashExpandLocation {
  funcSuffix: string;
  fieldName: string;
  /**
   * When true, the candidate loop drops any `key=` value whose key part is
   * already present in `_used_field_keys[<fieldName>]`. Enables `-f
   * key=value -f <TAB>` style dedup for repeatable array options. Always
   * false for scalar options and positionals.
   */
  isArrayOption: boolean;
  /**
   * True when the host option is global. Globals keep their dedup bucket
   * in `_global_used_field_keys` (which is not cleared on subcommand
   * descent) so already-consumed `key=value` slots remain hidden from
   * descendant frames.
   */
  isGlobal: boolean;
  /**
   * Resolved sibling deps in `dependsOn` order. Each entry pairs the dep
   * name with its globality so the lookup reads from the correct bucket:
   * local deps from `_arg_values` only, global deps from
   * `_global_arg_values` only. Without this split, a local dep would
   * silently inherit a same-named global value supplied at a parent
   * frame.
   */
  resolvedDeps: readonly ResolvedExpandDep[];
}

/**
 * Generate bash value completion code for a ValueCompletion spec.
 * `location` is required when `vc.type === "expand"` (otherwise unused).
 */
function bashValueLines(
  vc: ValueCompletion | undefined,
  inline: boolean,
  fn: string,
  location?: BashExpandLocation,
): string[] {
  if (!vc) return [];

  switch (vc.type) {
    case "expand": {
      if (!location) {
        throw new Error("bashValueLines: expand variant requires a location");
      }
      // The expand table is hoisted as per-entry scalar variables (one
      // per key combination). Build the encoded runtime suffix from the
      // dependsOn values via `__<fn>_enc`, then read the candidate list
      // through indirect expansion and filter against `$_cur`.
      const varName = bashExpandVar(fn, location.funcSuffix, location.fieldName);
      // Per-dep lookups read from the matching prefix-scalar bucket:
      // globals from `_global_arg_values_<dep>` (preserved across
      // subcommand descent), locals from `_arg_values_<dep>` (cleared on
      // descent). Mixing the two would let a global value silently
      // substitute for a missing local dep of the same name.
      const encLines: string[] = [`local _enc_key='' _enc_v`];
      location.resolvedDeps.forEach((d, i) => {
        const safe = sanitize(d.name);
        const varRef = d.isGlobal ? `_global_arg_values_${safe}` : `_arg_values_${safe}`;
        encLines.push(`_enc_v="\${${varRef}:-}"`);
        encLines.push(
          i === 0 ? `_enc_key="$(__${fn}_enc "$_enc_v")"` : `_enc_key+="_$(__${fn}_enc "$_enc_v")"`,
        );
      });
      const inlineExpr = inline ? `"\${_inline_prefix}\${_c}"` : `"$_c"`;
      // The array dedup bucket for a global expand host lives in
      // _global_used_field_keys_<bucket> so already-consumed keys survive
      // descent. Bash 3.2 prefix-scalar shape — see the table emission
      // above for the matching writer side.
      const bucketRef = location.isGlobal
        ? `\${_global_used_field_keys_${sanitize(location.fieldName)}:-}`
        : `\${_used_field_keys_${sanitize(location.fieldName)}:-}`;
      const dedupLines = location.isArrayOption
        ? [
            `        if [[ "$_c" == *=* ]]; then`,
            `            local _ck="\${_c%%=*}"`,
            `            if [[ -n "$_ck" && " ${bucketRef} " == *" $_ck "* ]]; then continue; fi`,
            `        fi`,
          ]
        : [];
      return [
        // Suppress bash's `-o default` filename fallback before any
        // early-return so an expand spec with no candidates does not
        // silently degrade into file completion.
        `compopt +o default 2>/dev/null`,
        ...encLines,
        // If no entry was emitted for this dep combination, indirect
        // expansion yields the empty string and the block below is a
        // no-op — no separate guard needed.
        `local _varname=${varName}__\${_enc_key}`,
        `local _raw="\${!_varname:-}"`,
        `if [[ -n "$_raw" ]]; then`,
        `    local -a _vals=()`,
        `    local _line`,
        `    while IFS= read -r _line; do _vals+=("$_line"); done <<< "$_raw"`,
        `    local _c`,
        `    for _c in "\${_vals[@]}"; do`,
        `        [[ -z "$_c" ]] && continue`,
        ...dedupLines,
        `        [[ "$_c" == "$_cur"* ]] && COMPREPLY+=(${inlineExpr})`,
        `    done`,
        `    compopt -o nospace 2>/dev/null`,
        `fi`,
      ];
    }
    case "dynamic": {
      // Delegate to `<program> __complete --shell bash`; the politty bash
      // formatter already prepends the inline prefix to each candidate, so
      // the consumer just drops sentinel lines.
      return [
        `local _dyn_out`,
        `_dyn_out=$(__${fn}_invoke_complete bash "\${_words[@]}")`,
        `__${fn}_apply_dynamic_output "$_dyn_out"`,
      ];
    }
    case "choices": {
      const items = vc.choices!.map((c) => `"${escapeBashDQ(c)}"`).join(" ");
      // `$_inline_prefix` is empty in non-inline mode, so the same loop
      // handles both: a set prefix gets prepended, an empty one is a no-op.
      // `compopt -o nospace` is inline-only — it suppresses the trailing
      // space after `--opt=value` so the user can keep typing.
      const lines = [
        `local -a _choices=(${items})`,
        `COMPREPLY=()`,
        `local _c; for _c in "\${_choices[@]}"; do [[ "$_c" == "$_cur"* ]] && COMPREPLY+=("\${_inline_prefix}\${_c}"); done`,
      ];
      if (inline) lines.push(`compopt -o nospace`);
      lines.push(`compopt +o default 2>/dev/null`);
      return lines;
    }
    case "file": {
      if (vc.matcher?.length) {
        const checks = vc.matcher.map((p) => `[[ "\${_f##*/}" == ${p} ]]`).join(" || ");
        return bashFileFilter(checks);
      }
      if (vc.extensions?.length) {
        const checks = vc.extensions.map((ext) => `[[ "$_f" == *".${ext}" ]]`).join(" || ");
        return bashFileFilter(checks);
      }
      // `compgen -P` prepends the inline prefix when set; an empty prefix
      // is a no-op, so the same emission works for both modes.
      return [`COMPREPLY=($(compgen -P "$_inline_prefix" -f -- "$_cur"))`, `compopt -o filenames`];
    }
    case "directory":
      return [`COMPREPLY=($(compgen -P "$_inline_prefix" -d -- "$_cur"))`, `compopt -o filenames`];
    case "command":
      return [`COMPREPLY=($(compgen -P "$_inline_prefix" -W "$(${vc.shellCommand!})" -- "$_cur"))`];
    case "none":
      return [`compopt +o default 2>/dev/null`];
  }
}

function bashFileFilter(checks: string): string[] {
  // `$_inline_prefix` is empty in non-inline mode, so the same template
  // works for both: a set prefix gets prepended, an empty one is a no-op.
  return [
    `local -a _all_entries=($(compgen -f -- "$_cur"))`,
    `for _f in "\${_all_entries[@]}"; do`,
    `    if [[ -d "$_f" ]]; then`,
    `        COMPREPLY+=("\${_inline_prefix}$_f")`,
    `    elif ${checks}; then`,
    `        COMPREPLY+=("\${_inline_prefix}$_f")`,
    `    fi`,
    `done`,
    `compopt -o filenames`,
    `compopt +o default 2>/dev/null`,
  ];
}

/** Collect value-taking option patterns for case matching */
function optionValueCases(
  options: CompletableOption[],
  inline: boolean,
  fn: string,
  funcSuffix: string,
): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = bashValueLines(opt.valueCompletion, inline, fn, {
      funcSuffix,
      fieldName: opt.name,
      isArrayOption: opt.valueType === "array",
      isGlobal: opt.isGlobal === true,
      resolvedDeps: resolveExpandDepGlobality(opt.valueCompletion, opt.isGlobal === true),
    });
    if (valLines.length === 0) continue;

    const patternStr = collectOptionTokens(opt.cliName, opt.alias).join("|");

    lines.push(`            ${patternStr})`);
    for (const vl of valLines) {
      lines.push(`                ${vl}`);
    }
    lines.push(`                return ;;`);
  }
  return lines;
}

/** Generate positional completion block */
function positionalBlock(
  positionals: CompletablePositional[],
  fn: string,
  funcSuffix: string,
): string[] {
  if (positionals.length === 0) return [];
  const lines: string[] = [];
  lines.push(`    case "$_pos_count" in`);

  for (const pos of positionals) {
    if (pos.variadic) {
      // Variadic: use * to match any position from this index onward
      lines.push(`        ${pos.position}|*)`);
    } else {
      lines.push(`        ${pos.position})`);
    }
    for (const vl of bashValueLines(pos.valueCompletion, false, fn, {
      funcSuffix,
      fieldName: pos.name,
      isArrayOption: false,
      isGlobal: false,
      resolvedDeps: pos.valueCompletion
        ? resolveExpandDepGlobality(pos.valueCompletion, false)
        : [],
    })) {
      lines.push(`            ${vl}`);
    }
    lines.push(`            ;;`);
  }

  lines.push(`    esac`);
  return lines;
}

/** Generate prev/inline value completion blocks for options */
function valueCompletionBlocks(
  options: CompletableOption[],
  fn: string,
  funcSuffix: string,
): string[] {
  if (!options.some((o) => o.takesValue && o.valueCompletion)) return [];

  const lines: string[] = [];
  const prevCases = optionValueCases(options, false, fn, funcSuffix);
  if (prevCases.length > 0) {
    lines.push(`    if [[ -z "$_inline_prefix" ]]; then`);
    lines.push(`        case "$_prev" in`);
    lines.push(...prevCases);
    lines.push(`        esac`);
    lines.push(`    fi`);
  }
  const inlineCases = optionValueCases(options, true, fn, funcSuffix);
  if (inlineCases.length > 0) {
    lines.push(`    if [[ -n "$_inline_prefix" ]]; then`);
    lines.push(`        case "\${_inline_prefix%=}" in`);
    lines.push(...inlineCases);
    lines.push(`        esac`);
    lines.push(`    fi`);
  }
  return lines;
}

/** Generate available-options list lines */
function availableOptionLines(options: CompletableOption[], fn: string): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (opt.valueType === "array") {
      // Array options can be specified multiple times — always keep available
      lines.push(`        _avail+=(--${opt.cliName})`);
      continue;
    }
    const patterns = quotedAvailabilityTokens(opt.cliName, opt.alias, opt.negation);
    const guard = `__${fn}_not_used ${patterns.join(" ")}`;
    const emitNames = opt.negation ? [opt.cliName, opt.negation] : [opt.cliName];
    for (const name of emitNames) {
      lines.push(`        ${guard} && _avail+=(--${name})`);
    }
  }
  lines.push(`        __${fn}_not_used "--help" && _avail+=(--help)`);
  return lines;
}

/**
 * Generate a per-subcommand completion function.
 * Recursively generates functions for nested subcommands.
 */
function generateSubHandler(sub: CompletableSubcommand, fn: string, path: string[]): string[] {
  const fullPath = [...path, sub.name];
  const funcSuffix = fullPath.map(sanitize).join("_");
  const funcName = `__${fn}_complete_${funcSuffix}`;
  const visibleSubs = getVisibleSubs(sub.subcommands);

  const lines: string[] = [];

  // Recursively generate handlers for child subcommands
  for (const child of visibleSubs) {
    lines.push(...generateSubHandler(child, fn, fullPath));
  }

  lines.push(`${funcName}() {`);

  // 1. Option value completion (prev is value-taking option)
  lines.push(...valueCompletionBlocks(sub.options, fn, funcSuffix));

  // Fallback: value-taking option without explicit completion → default file completion
  const fullPathStr = fullPath.join(":");
  lines.push(
    `    if [[ -z "$_inline_prefix" ]] && __${fn}_opt_takes_value "${fullPathStr}" "$_prev"; then return; fi`,
  );
  lines.push(
    `    if [[ -n "$_inline_prefix" ]] && __${fn}_opt_takes_value "${fullPathStr}" "\${_inline_prefix%=}"; then return; fi`,
  );

  // 2. After -- separator
  if (sub.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(sub.positionals, fn, funcSuffix).map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return; fi`);
  }

  // 3. Option name completion
  lines.push(`    if [[ "$_cur" == -* ]]; then`);
  lines.push(`        local -a _avail=()`);
  lines.push(...availableOptionLines(sub.options, fn));
  lines.push(`        COMPREPLY=($(compgen -W "\${_avail[*]}" -- "$_cur"))`);
  lines.push(`        compopt +o default 2>/dev/null`);
  lines.push(`        return`);
  lines.push(`    fi`);

  // 4. Subcommand or positional completion
  if (visibleSubs.length > 0) {
    const subNames = getSubNamesWithAliases(sub.subcommands)
      .map((s) => s.name)
      .join(" ");
    lines.push(`    COMPREPLY=($(compgen -W "${subNames}" -- "$_cur"))`);
    lines.push(`    compopt +o default 2>/dev/null`);
  } else if (sub.positionals.length > 0) {
    lines.push(...positionalBlock(sub.positionals, fn, funcSuffix));
  }

  lines.push(`}`);
  lines.push(``);
  return lines;
}

export function generateBashCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  const { programName } = options;
  const data = extractCompletionData(command, programName, options.globalArgsSchema);
  const fn = sanitize(programName);
  const root = data.command;
  const visibleSubs = getVisibleSubs(root.subcommands);
  const expandSpecs = collectExpandSpecs(root);
  const trackedFields = collectTrackedFields(root, expandSpecs, data.globalOptions);

  const lines: string[] = [];
  lines.push(`# Bash completion for ${programName}`);
  lines.push(`# Generated by politty`);
  lines.push(``);

  const hasExpand = expandSpecs.length > 0;
  const arrayExpandSpecs = expandSpecs.filter((s) => s.isArrayOption);
  const hasArrayExpand = arrayExpandSpecs.length > 0;

  // Expand-completion hoisted tables. Bash 3.2 (macOS default
  // `/bin/bash`) has no associative arrays, so each table entry becomes a
  // top-level scalar `<base>__<encKey>=<candidates>`. The runtime helper
  // `__<fn>_enc` (emitted once below when `hasExpand`) builds the same
  // encoded suffix from the user's runtime dep values; lookups read via
  // indirect expansion `${!_varname:-}`.
  if (hasExpand) {
    lines.push(`__${fn}_enc() {`);
    lines.push(`    local _s=$1 _r='' _c _i`);
    lines.push(`    for (( _i=0; _i<\${#_s}; _i++ )); do`);
    lines.push(`        _c=\${_s:_i:1}`);
    lines.push(`        case "$_c" in`);
    lines.push(`            [a-zA-Z0-9]) _r+="$_c" ;;`);
    lines.push(`            *) printf -v _r '%s_%02X' "$_r" "'$_c" ;;`);
    lines.push(`        esac`);
    lines.push(`    done`);
    lines.push(`    printf '%s' "$_r"`);
    lines.push(`}`);
    lines.push(``);
  }
  for (const spec of expandSpecs) {
    const varName = bashExpandVar(fn, spec.funcSuffix, spec.fieldName);
    for (const entry of spec.vc.table) {
      const encKey = entry.key.map(bashEncodeKey).join("_");
      const value = entry.candidates.map((c) => c.value).join("\n");
      lines.push(`${varName}__${encKey}=${ansiC(value)}`);
    }
    lines.push(``);
  }

  // Dynamic completion delegate helpers (only when any value spec uses
  // an in-process JS resolver). The static script invokes
  // `<program> __complete --shell bash` and parses the candidate stream.
  if (hasDynamicCompletion(root)) {
    lines.push(`__${fn}_invoke_complete() {`);
    lines.push(`    local _shell="$1"; shift`);
    lines.push(
      `    "\${${binEnvVarName(fn)}:-${programName}}" __complete --shell "$_shell" -- "$@" 2>/dev/null`,
    );
    lines.push(`}`);
    lines.push(``);
    lines.push(`__${fn}_apply_dynamic_output() {`);
    lines.push(`    local _raw="$1"`);
    lines.push(`    COMPREPLY=()`);
    lines.push(`    local _directive=0`);
    lines.push(`    local -a _lines=()`);
    lines.push(`    local _line`);
    lines.push(`    while IFS= read -r _line; do _lines+=("$_line"); done <<< "$_raw"`);
    // Only the trailing line is the directive sentinel; intermediate lines
    // beginning with `:` are legitimate candidate values.
    lines.push(`    local _last=$((\${#_lines[@]} - 1))`);
    lines.push(`    if (( _last >= 0 )) && [[ "\${_lines[$_last]}" =~ ^:[0-9]+$ ]]; then`);
    lines.push(`        _directive="\${_lines[$_last]#:}"`);
    lines.push(`        unset '_lines[_last]'`);
    lines.push(`    fi`);
    lines.push(`    for _line in "\${_lines[@]}"; do`);
    // Skip only blanks. The `@ext:`/`@matcher:` sentinels are produced by
    // the static shellCommand pipeline, not by dynamic resolvers — filtering
    // them here would silently drop resolver candidates that happen to
    // start with those literal strings.
    lines.push(`        [[ -z "$_line" ]] && continue`);
    lines.push(`        COMPREPLY+=("$_line")`);
    lines.push(`    done`);
    // Apply resolver-supplied directive bits. DirectoryCompletion takes
    // precedence over FileCompletion when both are set; NoSpace stacks.
    // bash's `-o default` / `-o dirnames` fall back to filename
    // completion only when COMPREPLY is empty, but their candidates use
    // the *original* word — which still carries the `--opt=` prefix we
    // stripped into `_inline_prefix`. So whenever an inline prefix is
    // in play, expand filesystem matches manually against `$_cur` and
    // prepend `_ip`, instead of leaving it to bash's fallback. With no
    // inline prefix, the empty-COMPREPLY case can still rely on the
    // builtin fallback.
    lines.push(`    local _ip="\${_inline_prefix:-}"`);
    lines.push(`    if (( _directive & ${CompletionDirective.DirectoryCompletion} )); then`);
    lines.push(`        compopt +o default 2>/dev/null`);
    lines.push(`        if (( \${#COMPREPLY[@]} > 0 )) || [[ -n "$_ip" ]]; then`);
    lines.push(`            local _d`);
    lines.push(
      `            while IFS= read -r _d; do COMPREPLY+=("\${_ip}\${_d}"); done < <(compgen -d -- "$_cur")`,
    );
    lines.push(`        else`);
    lines.push(`            compopt -o dirnames 2>/dev/null`);
    lines.push(`        fi`);
    lines.push(`    elif (( _directive & ${CompletionDirective.FileCompletion} )); then`);
    lines.push(`        if (( \${#COMPREPLY[@]} > 0 )) || [[ -n "$_ip" ]]; then`);
    lines.push(`            local _f`);
    lines.push(
      `            while IFS= read -r _f; do COMPREPLY+=("\${_ip}\${_f}"); done < <(compgen -f -- "$_cur")`,
    );
    lines.push(`        else`);
    lines.push(`            compopt -o default 2>/dev/null`);
    lines.push(`        fi`);
    lines.push(`    else`);
    lines.push(`        compopt +o default 2>/dev/null`);
    lines.push(`    fi`);
    lines.push(`    if (( _directive & ${CompletionDirective.NoSpace} )); then`);
    lines.push(`        compopt -o nospace 2>/dev/null`);
    lines.push(`    fi`);
    lines.push(`}`);
    lines.push(``);
  }

  // Helper: check if option is already used
  lines.push(`__${fn}_not_used() {`);
  lines.push(`    for _u in "\${_used_opts[@]}"; do`);
  lines.push(`        for _chk in "$@"; do`);
  lines.push(`            [[ "$_u" == "$_chk" ]] && return 1`);
  lines.push(`        done`);
  lines.push(`    done`);
  lines.push(`    return 0`);
  lines.push(`}`);
  lines.push(``);

  // Helper: check if option takes a value
  lines.push(`__${fn}_opt_takes_value() {`);
  lines.push(`    case "$1:$2" in`);
  lines.push(...optTakesValueEntries(root, ""));
  lines.push(`    esac`);
  lines.push(`    return 1`);
  lines.push(`}`);
  lines.push(``);

  if (hasExpand) {
    // Trackers populate `_arg_values` during the main scan loop so the
    // per-spec lookup can dispatch on sibling arg values. `_track_opt`
    // runs for every option-value pair; `_track_pos` runs once per
    // positional.
    lines.push(`__${fn}_track_opt() {`);
    lines.push(`    case "$1:$2" in`);
    lines.push(...trackOptCaseLines(trackedFields, "bash"));
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`__${fn}_track_pos() {`);
    lines.push(`    case "$1:$2" in`);
    lines.push(...trackPosCaseLines(trackedFields, "bash"));
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
  }

  if (hasArrayExpand) {
    // Track which `key=` slots a repeatable array option has already
    // consumed. Separate function (and bucket) from `__track_opt` so an
    // option that is simultaneously a dependsOn target and an array
    // expand host doesn't collide on the same case pattern. The bucket
    // is space-padded on both ends so membership checks via
    // `*" $_ck "*` work for the first and last entries.
    lines.push(`__${fn}_track_array_expand() {`);
    lines.push(`    case "$1:$2" in`);
    lines.push(...trackArrayExpandCaseLines(arrayExpandSpecs, "bash"));
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
  }

  // Collect all nested subcommand routes (used for both is_subcmd and dispatch)
  const routeEntries = collectRouteEntries(root);

  // Helper: check if a word is a known subcommand at the current path level
  if (routeEntries.length > 0) {
    lines.push(`__${fn}_is_subcmd() {`);
    lines.push(`    case "$1:$2" in`);
    lines.push(...isSubcmdCaseLines(routeEntries));
    lines.push(`    esac`);
    lines.push(`    return 1`);
    lines.push(`}`);
    lines.push(``);
  }

  // Per-subcommand completion functions
  for (const sub of visibleSubs) {
    lines.push(...generateSubHandler(sub, fn, []));
  }

  // Root handler
  lines.push(`__${fn}_complete_root() {`);
  lines.push(...valueCompletionBlocks(root.options, fn, "root"));
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(
    `    if [[ -z "$_inline_prefix" ]] && __${fn}_opt_takes_value "" "$_prev"; then return; fi`,
  );
  lines.push(
    `    if [[ -n "$_inline_prefix" ]] && __${fn}_opt_takes_value "" "\${_inline_prefix%=}"; then return; fi`,
  );
  if (root.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(root.positionals, fn, "root").map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return; fi`);
  }
  lines.push(`    if [[ "$_cur" == -* ]]; then`);
  lines.push(`        local -a _avail=()`);
  lines.push(...availableOptionLines(root.options, fn));
  lines.push(`        COMPREPLY=($(compgen -W "\${_avail[*]}" -- "$_cur"))`);
  lines.push(`        compopt +o default 2>/dev/null`);
  if (visibleSubs.length > 0) {
    lines.push(`    else`);
    const subNames = getSubNamesWithAliases(root.subcommands)
      .map((s) => s.name)
      .join(" ");
    lines.push(`        COMPREPLY=($(compgen -W "${subNames}" -- "$_cur"))`);
    lines.push(`        compopt +o default 2>/dev/null`);
  } else if (root.positionals.length > 0) {
    lines.push(`    else`);
    lines.push(...positionalBlock(root.positionals, fn, "root").map((l) => `    ${l}`));
  }
  lines.push(`    fi`);
  lines.push(`}`);
  lines.push(``);

  // Main completion function -- subcommand dispatch routing
  const subRouting = subDispatchCaseLines(routeEntries, fn).join("\n");

  lines.push(`_${fn}_completions() {`);
  lines.push(`    COMPREPLY=()`);
  lines.push(``);
  lines.push(`    # Rejoin words split by '=' in COMP_WORDBREAKS`);
  lines.push(`    local -a _words=()`);
  lines.push(`    local _i=1`);
  lines.push(`    while (( _i <= COMP_CWORD )); do`);
  lines.push(`        if [[ "\${COMP_WORDS[_i]}" == "=" && \${#_words[@]} -gt 0 ]]; then`);
  lines.push(`            _words[\${#_words[@]}-1]+="=\${COMP_WORDS[_i+1]:-}"`);
  lines.push(`            (( _i += 2 ))`);
  lines.push(`        else`);
  lines.push(`            _words+=("\${COMP_WORDS[_i]}")`);
  lines.push(`            (( _i++ ))`);
  lines.push(`        fi`);
  lines.push(`    done`);
  lines.push(``);
  lines.push(`    local _cur=""`);
  lines.push(`    (( \${#_words[@]} > 0 )) && _cur="\${_words[\${#_words[@]}-1]}"`);
  lines.push(``);
  lines.push(`    local _inline_prefix=""`);
  lines.push(`    if [[ "$_cur" == --*=* ]]; then`);
  lines.push(`        _inline_prefix="\${_cur%%=*}="`);
  lines.push(`        _cur="\${_cur#*=}"`);
  lines.push(`    fi`);
  lines.push(``);
  lines.push(`    local _prev=""`);
  lines.push(`    (( \${#_words[@]} > 1 )) && _prev="\${_words[\${#_words[@]}-2]}"`);
  lines.push(``);
  lines.push(`    local _subcmd="" _after_dd=0 _pos_count=0 _skip_next=0`);
  lines.push(`    local -a _used_opts=()`);
  if (hasExpand) {
    // Bash 3.2 has no associative arrays — trackers write per-field
    // scalars (`_arg_values_<field>`, `_global_arg_values_<field>`).
    // Wipe any leftovers from a previous invocation so completion state
    // is fresh on every TAB. Globals survive subcommand descent within
    // the same invocation (re-populated below by the scan loop) but must
    // not bleed across invocations.
    lines.push(`    unset $(compgen -v _arg_values_ 2>/dev/null) 2>/dev/null`);
    lines.push(`    unset $(compgen -v _global_arg_values_ 2>/dev/null) 2>/dev/null`);
  }
  if (hasArrayExpand) {
    lines.push(`    unset $(compgen -v _used_field_keys_ 2>/dev/null) 2>/dev/null`);
    lines.push(`    unset $(compgen -v _global_used_field_keys_ 2>/dev/null) 2>/dev/null`);
    // Per-frame seen-set: marks which global array buckets have been
    // written in the current frame so the first write replaces the
    // inherited entries. Cleared on every subcommand descent below.
    lines.push(`    unset $(compgen -v _global_arr_seen_ 2>/dev/null) 2>/dev/null`);
  }
  lines.push(``);
  lines.push(`    local _j=0`);
  lines.push(`    while (( _j < \${#_words[@]} - 1 )); do`);
  lines.push(`        local _w="\${_words[_j]}"`);
  lines.push(`        if (( _skip_next )); then _skip_next=0; (( _j++ )); continue; fi`);
  lines.push(`        if [[ "$_w" == "--" ]]; then _after_dd=1; (( _j++ )); continue; fi`);
  // After `--`, all remaining words are positionals. Track them so an
  // expand spec that depends on a positional still sees the value.
  const afterDdTrack = hasExpand ? `__${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"; ` : "";
  lines.push(
    `        if (( _after_dd )); then ${afterDdTrack}(( _pos_count++ )); (( _j++ )); continue; fi`,
  );
  // Match both `--opt=value` and `-o=value`: the parser accepts the
  // short inline form too, so the scanner must split it before tracking
  // the dep value, otherwise `-e=prod` slips past the tracker.
  lines.push(`        if [[ "$_w" == -*=* ]]; then`);
  lines.push(`            _used_opts+=("\${_w%%=*}")`);
  if (hasExpand) {
    lines.push(`            __${fn}_track_opt "$_subcmd" "\${_w%%=*}" "\${_w#*=}"`);
    if (hasArrayExpand) {
      lines.push(`            __${fn}_track_array_expand "$_subcmd" "\${_w%%=*}" "\${_w#*=}"`);
    }
  }
  lines.push(`            (( _j++ )); continue`);
  lines.push(`        fi`);
  lines.push(`        if [[ "$_w" == -* ]]; then`);
  lines.push(`            _used_opts+=("$_w")`);
  // Mirror the runtime parser: a token starting with `-` is the next
  // option, not this option's value, so don't skip/track it. Otherwise
  // `--config --env prod --field <TAB>` treats `--env` as `--config`'s
  // value and the expand dep is lost.
  lines.push(`            if __${fn}_opt_takes_value "$_subcmd" "$_w"; then`);
  lines.push(`                local _next="\${_words[_j+1]:-}"`);
  lines.push(`                if [[ -n "$_next" && "$_next" != -* ]]; then _skip_next=1; fi`);
  if (hasExpand) {
    lines.push(`                if (( _skip_next )); then`);
    lines.push(`                    __${fn}_track_opt "$_subcmd" "$_w" "$_next"`);
    if (hasArrayExpand) {
      // Skip array-expand dedup tracking when the next token is the word
      // being completed. Otherwise typing `-f pageDirection=<TAB>` marks
      // the partial cursor value as already used and filters out the
      // candidates the user is trying to select.
      lines.push(`                    if (( _j + 2 < \${#_words[@]} )); then`);
      lines.push(`                        __${fn}_track_array_expand "$_subcmd" "$_w" "$_next"`);
      lines.push(`                    fi`);
    }
    lines.push(`                fi`);
  }
  lines.push(`            fi`);
  lines.push(`            (( _j++ )); continue`);
  lines.push(`        fi`);
  // Clear sibling-tracker state when descending into a subcommand:
  // `dependsOn` is scoped to siblings on the same command frame, so
  // letting a parent's `--env` bleed into a child with its own `--env`
  // would feed the wrong value into the child's expand lookup.
  // Prefix-scalar equivalent of the bash 4 `_arg_values=()` reset: drop
  // every per-field scalar written by the trackers so far. compgen -v
  // takes a prefix and prints matching variable names; bash 3.2+.
  const clearState = hasArrayExpand
    ? `; unset $(compgen -v _arg_values_ 2>/dev/null) $(compgen -v _used_field_keys_ 2>/dev/null) $(compgen -v _global_arr_seen_ 2>/dev/null) 2>/dev/null`
    : hasExpand
      ? `; unset $(compgen -v _arg_values_ 2>/dev/null) 2>/dev/null`
      : "";
  const posTrack = hasExpand ? `__${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"; ` : "";
  if (routeEntries.length > 0) {
    lines.push(
      `        if __${fn}_is_subcmd "$_subcmd" "$_w"; then _subcmd="\${_subcmd:+\${_subcmd}:}$_w"; _used_opts=(); _pos_count=0${clearState}; else ${posTrack}(( _pos_count++ )); fi`,
    );
  } else {
    if (hasExpand) {
      lines.push(`        __${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"`);
    }
    lines.push(`        (( _pos_count++ ))`);
  }
  lines.push(`        (( _j++ ))`);
  lines.push(`    done`);
  lines.push(``);
  lines.push(`    case "$_subcmd" in`);
  lines.push(subRouting);
  lines.push(`        *) __${fn}_complete_root ;;`);
  lines.push(`    esac`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`complete -o default -F _${fn}_completions ${programName}`);
  lines.push(``);

  return {
    script: lines.join("\n"),
    shell: "bash",
    installInstructions: `# To enable completions, add the following to your ~/.bashrc:

# Option 1: Source directly
eval "$(${programName} completion bash)"

# Option 2: Save to a file
${programName} completion bash > ~/.local/share/bash-completion/completions/${programName}

# Then reload your shell or run:
source ~/.bashrc`,
  };
}
