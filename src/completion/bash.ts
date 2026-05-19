/**
 * Bash completion script generator (static)
 *
 * Generates a self-contained bash completion script that embeds all
 * completion metadata. No Node.js process is spawned on TAB.
 */

import type { AnyCommand } from "../types.js";
import { CompletionDirective } from "./dynamic/candidate-generator.js";
import {
  collectExpandSpecs,
  collectRouteEntries,
  collectTrackedFields,
  extractCompletionData,
  getSubNamesWithAliases,
  getVisibleSubs,
  hasDynamicCompletion,
  isSubcmdCaseLines,
  optTakesValueEntries,
  sanitize,
} from "./extractor.js";
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

/** Variable name for the hoisted expand table for a (funcSuffix, fieldName). */
function bashExpandVar(fn: string, funcSuffix: string, fieldName: string): string {
  return `__${fn}_expand_${funcSuffix}__${sanitize(fieldName)}`;
}

/**
 * Encode a string as an ANSI-C bash literal: `$'…'` with backslash escapes.
 * Used for expand-table values so newlines and the unit-separator key
 * delimiter survive intact through `mapfile` parsing.
 */
function bashAnsiC(s: string): string {
  let out = "$'";
  for (const ch of s) {
    const code = ch.codePointAt(0)!;
    if (ch === "\\") out += "\\\\";
    else if (ch === "'") out += "\\'";
    else if (ch === "\n") out += "\\n";
    else if (ch === "\r") out += "\\r";
    else if (ch === "\t") out += "\\t";
    else if (code < 0x20 || code === 0x7f) out += `\\x${code.toString(16).padStart(2, "0")}`;
    else out += ch;
  }
  out += "'";
  return out;
}

/** Encode a string as a double-quoted bash literal for use inside `[...]=`. */
function bashLiteral(s: string): string {
  return bashAnsiC(s);
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
      // The expand table is hoisted as a global associative array. Build
      // the runtime lookup key from the dependsOn values, fetch the
      // (newline-separated) candidate list, and filter against `$_cur`.
      const varName = bashExpandVar(fn, location.funcSuffix, location.fieldName);
      const depKey = vc.dependsOn.map((d) => `"\${_arg_values[${d}]:-}"`).join(`$'\\x1f'`);
      const inlineExpr = inline ? `"\${_inline_prefix}\${_c}"` : `"$_c"`;
      const dedupLines = location.isArrayOption
        ? [
            `        if [[ "$_c" == *=* ]]; then`,
            `            local _ck="\${_c%%=*}"`,
            `            if [[ -n "$_ck" && " \${_used_field_keys[${sanitize(location.fieldName)}]:-} " == *" $_ck "* ]]; then continue; fi`,
            `        fi`,
          ]
        : [];
      return [
        `local _key=${depKey}`,
        `local _raw="\${${varName}[$_key]:-}"`,
        `if [[ -n "$_raw" ]]; then`,
        `    local -a _vals=()`,
        `    mapfile -t _vals <<< "$_raw"`,
        `    local _c`,
        `    for _c in "\${_vals[@]}"; do`,
        `        [[ -z "$_c" ]] && continue`,
        ...dedupLines,
        `        [[ "$_c" == "$_cur"* ]] && COMPREPLY+=(${inlineExpr})`,
        `    done`,
        `    compopt -o nospace 2>/dev/null`,
        `    compopt +o default 2>/dev/null`,
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
      if (inline) {
        return [
          `local -a _choices=(${items})`,
          `COMPREPLY=()`,
          `local _c; for _c in "\${_choices[@]}"; do [[ "$_c" == "$_cur"* ]] && COMPREPLY+=("\${_inline_prefix}\${_c}"); done`,
          `compopt -o nospace`,
          `compopt +o default 2>/dev/null`,
        ];
      }
      return [
        `local -a _choices=(${items})`,
        `COMPREPLY=()`,
        `local _c; for _c in "\${_choices[@]}"; do [[ "$_c" == "$_cur"* ]] && COMPREPLY+=("$_c"); done`,
        `compopt +o default 2>/dev/null`,
      ];
    }
    case "file": {
      if (vc.matcher?.length) {
        const checks = vc.matcher.map((p) => `[[ "\${_f##*/}" == ${p} ]]`).join(" || ");
        return bashFileFilter(checks, inline);
      }
      if (vc.extensions?.length) {
        const checks = vc.extensions.map((ext) => `[[ "$_f" == *".${ext}" ]]`).join(" || ");
        return bashFileFilter(checks, inline);
      }
      if (inline) {
        return [
          `local -a _entries=($(compgen -f -- "$_cur"))`,
          `COMPREPLY=("\${_entries[@]/#/$_inline_prefix}")`,
          `compopt -o filenames`,
        ];
      }
      return [`COMPREPLY=($(compgen -f -- "$_cur"))`, `compopt -o filenames`];
    }
    case "directory": {
      if (inline) {
        return [
          `local -a _dirs=($(compgen -d -- "$_cur"))`,
          `COMPREPLY=("\${_dirs[@]/#/$_inline_prefix}")`,
          `compopt -o filenames`,
        ];
      }
      return [`COMPREPLY=($(compgen -d -- "$_cur"))`, `compopt -o filenames`];
    }
    case "command": {
      const cmd = vc.shellCommand!;
      if (inline) {
        return [`COMPREPLY=($(compgen -P "$_inline_prefix" -W "$(${cmd})" -- "$_cur"))`];
      }
      return [`COMPREPLY=($(compgen -W "$(${cmd})" -- "$_cur"))`];
    }
    case "none":
      return [`compopt +o default 2>/dev/null`];
  }
}

function bashFileFilter(checks: string, inline: boolean): string[] {
  const prefix = inline ? `"\${_inline_prefix}$_f"` : `"$_f"`;
  return [
    `local -a _all_entries=($(compgen -f -- "$_cur"))`,
    `for _f in "\${_all_entries[@]}"; do`,
    `    if [[ -d "$_f" ]]; then`,
    `        COMPREPLY+=(${prefix})`,
    `    elif ${checks}; then`,
    `        COMPREPLY+=(${prefix})`,
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
    });
    if (valLines.length === 0) continue;

    const patterns: string[] = [`--${opt.cliName}`];
    if (opt.alias) {
      for (const a of opt.alias) {
        patterns.push(a.length === 1 ? `-${a}` : `--${a}`);
      }
    }
    const patternStr = patterns.join("|");

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
    } else {
      const patterns: string[] = [`"--${opt.cliName}"`];
      if (opt.alias) {
        for (const a of opt.alias) {
          patterns.push(a.length === 1 ? `"-${a}"` : `"--${a}"`);
        }
      }
      if (opt.negation) {
        patterns.push(`"--${opt.negation}"`);
      }
      lines.push(`        __${fn}_not_used ${patterns.join(" ")} && _avail+=(--${opt.cliName})`);
      if (opt.negation) {
        lines.push(`        __${fn}_not_used ${patterns.join(" ")} && _avail+=(--${opt.negation})`);
      }
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
  const trackedFields = collectTrackedFields(root, expandSpecs);

  const lines: string[] = [];
  lines.push(`# Bash completion for ${programName}`);
  lines.push(`# Generated by politty`);
  lines.push(``);

  const hasExpand = expandSpecs.length > 0;
  const arrayExpandSpecs = expandSpecs.filter((s) => s.isArrayOption);
  const hasArrayExpand = arrayExpandSpecs.length > 0;

  // Expand-completion hoisted tables. One global associative array per
  // expand spec; entries map `dependsOn`-joined keys to newline-separated
  // candidate lists. Declared once at script source-time so per-invocation
  // overhead is just a hash lookup.
  for (const spec of expandSpecs) {
    const varName = bashExpandVar(fn, spec.funcSuffix, spec.fieldName);
    lines.push(`declare -gA ${varName}=()`);
    for (const entry of spec.vc.table) {
      const key = entry.key.join("");
      const value = entry.candidates.map((c) => c.value).join("\n");
      lines.push(`${varName}[${bashLiteral(key)}]=${bashAnsiC(value)}`);
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
      `    "\${${fn.toUpperCase()}_BIN:-${programName}}" __complete --shell "$_shell" -- "$@" 2>/dev/null`,
    );
    lines.push(`}`);
    lines.push(``);
    lines.push(`__${fn}_apply_dynamic_output() {`);
    lines.push(`    local _raw="$1"`);
    lines.push(`    COMPREPLY=()`);
    lines.push(`    local _directive=0`);
    lines.push(`    local -a _lines`);
    lines.push(`    mapfile -t _lines <<< "$_raw"`);
    // Only the trailing line is the directive sentinel; intermediate lines
    // beginning with `:` are legitimate candidate values.
    lines.push(`    local _last=$((\${#_lines[@]} - 1))`);
    lines.push(`    if (( _last >= 0 )) && [[ "\${_lines[$_last]}" =~ ^:[0-9]+$ ]]; then`);
    lines.push(`        _directive="\${_lines[$_last]#:}"`);
    lines.push(`        unset '_lines[_last]'`);
    lines.push(`    fi`);
    lines.push(`    local _line`);
    lines.push(`    for _line in "\${_lines[@]}"; do`);
    lines.push(`        case "$_line" in`);
    lines.push(`            "@ext:"*|"@matcher:"*) ;;`);
    lines.push(`            "") ;;`);
    lines.push(`            *) COMPREPLY+=("$_line") ;;`);
    lines.push(`        esac`);
    lines.push(`    done`);
    // Apply resolver-supplied directive bits. DirectoryCompletion takes
    // precedence over FileCompletion when both are set; NoSpace stacks.
    lines.push(`    if (( _directive & ${CompletionDirective.DirectoryCompletion} )); then`);
    lines.push(`        compopt -o dirnames 2>/dev/null`);
    lines.push(`    elif (( _directive & ${CompletionDirective.FileCompletion} )); then`);
    lines.push(`        compopt -o default 2>/dev/null`);
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
    // Helpers: capture sibling values into _arg_values during the scan
    // loop so the per-spec lookup can dispatch on them. `_track_opt` runs
    // for every option-value pair; `_track_pos` runs once per positional.
    lines.push(`__${fn}_track_opt() {`);
    lines.push(`    case "$1:$2" in`);
    for (const t of trackedFields) {
      if (t.isPositional) continue;
      const patterns: string[] = [`--${t.cliName}`];
      for (const a of t.longAliases ?? []) patterns.push(`--${a}`);
      for (const a of t.shortAliases ?? []) patterns.push(`-${a}`);
      const joined = patterns.map((n) => `${t.pathStr}:${n}`).join("|");
      lines.push(`        ${joined}) _arg_values[${t.fieldName}]="$3" ;;`);
    }
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`__${fn}_track_pos() {`);
    lines.push(`    case "$1:$2" in`);
    for (const t of trackedFields) {
      if (!t.isPositional) continue;
      lines.push(`        ${t.pathStr}:${t.position}) _arg_values[${t.fieldName}]="$3" ;;`);
    }
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
  }

  if (hasArrayExpand) {
    // Track which `key=` slots a repeatable array option has already
    // consumed. Stored in a separate function (and bucket) from
    // `__track_opt` so that an option which is simultaneously a dependsOn
    // target and an array expand host does not collide on the same case
    // pattern. The bucket is space-padded on both ends so membership
    // checks via `*" $_ck "*` work for the first and last entries.
    lines.push(`__${fn}_track_array_expand() {`);
    lines.push(`    case "$1:$2" in`);
    for (const spec of arrayExpandSpecs) {
      const joined = spec.optionTokens.map((tok) => `${spec.pathStr}:${tok}`).join("|");
      const bucket = sanitize(spec.fieldName);
      lines.push(`        ${joined})`);
      lines.push(`            if [[ "$3" == *=* ]]; then`);
      lines.push(`                local _k="\${3%%=*}"`);
      lines.push(`                [[ -n "$_k" ]] && _used_field_keys[${bucket}]+=" $_k "`);
      lines.push(`            fi`);
      lines.push(`            ;;`);
    }
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
  const subRouting = routeEntries
    .map((r) => `        ${r.pathStr}) __${fn}_complete_${r.funcSuffix} ;;`)
    .join("\n");

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
    lines.push(`    local -A _arg_values=()`);
  }
  if (hasArrayExpand) {
    lines.push(`    local -A _used_field_keys=()`);
  }
  lines.push(``);
  lines.push(`    local _j=0`);
  lines.push(`    while (( _j < \${#_words[@]} - 1 )); do`);
  lines.push(`        local _w="\${_words[_j]}"`);
  lines.push(`        if (( _skip_next )); then _skip_next=0; (( _j++ )); continue; fi`);
  lines.push(`        if [[ "$_w" == "--" ]]; then _after_dd=1; (( _j++ )); continue; fi`);
  lines.push(`        if (( _after_dd )); then (( _pos_count++ )); (( _j++ )); continue; fi`);
  if (hasExpand) {
    lines.push(`        if [[ "$_w" == --*=* ]]; then`);
    lines.push(`            _used_opts+=("\${_w%%=*}")`);
    lines.push(`            __${fn}_track_opt "$_subcmd" "\${_w%%=*}" "\${_w#*=}"`);
    if (hasArrayExpand) {
      lines.push(`            __${fn}_track_array_expand "$_subcmd" "\${_w%%=*}" "\${_w#*=}"`);
    }
    lines.push(`            (( _j++ )); continue`);
    lines.push(`        fi`);
  } else {
    lines.push(
      `        if [[ "$_w" == --*=* ]]; then _used_opts+=("\${_w%%=*}"); (( _j++ )); continue; fi`,
    );
  }
  lines.push(`        if [[ "$_w" == -* ]]; then`);
  lines.push(`            _used_opts+=("$_w")`);
  if (hasExpand) {
    if (hasArrayExpand) {
      lines.push(`            if __${fn}_opt_takes_value "$_subcmd" "$_w"; then`);
      lines.push(`                _skip_next=1`);
      lines.push(`                __${fn}_track_opt "$_subcmd" "$_w" "\${_words[_j+1]:-}"`);
      lines.push(
        `                __${fn}_track_array_expand "$_subcmd" "$_w" "\${_words[_j+1]:-}"`,
      );
      lines.push(`            fi`);
    } else {
      lines.push(
        `            if __${fn}_opt_takes_value "$_subcmd" "$_w"; then _skip_next=1; __${fn}_track_opt "$_subcmd" "$_w" "\${_words[_j+1]:-}"; fi`,
      );
    }
  } else {
    lines.push(`            __${fn}_opt_takes_value "$_subcmd" "$_w" && _skip_next=1`);
  }
  lines.push(`            (( _j++ )); continue`);
  lines.push(`        fi`);
  if (routeEntries.length > 0) {
    if (hasExpand) {
      lines.push(
        `        if __${fn}_is_subcmd "$_subcmd" "$_w"; then _subcmd="\${_subcmd:+\${_subcmd}:}$_w"; _used_opts=(); _pos_count=0; else __${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"; (( _pos_count++ )); fi`,
      );
    } else {
      lines.push(
        `        if __${fn}_is_subcmd "$_subcmd" "$_w"; then _subcmd="\${_subcmd:+\${_subcmd}:}$_w"; _used_opts=(); _pos_count=0; else (( _pos_count++ )); fi`,
      );
    }
  } else if (hasExpand) {
    lines.push(`        __${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"`);
    lines.push(`        (( _pos_count++ ))`);
  } else {
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
