/**
 * Zsh completion script generator (static)
 *
 * Generates a self-contained zsh completion script that embeds all
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

function escapeDesc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/:/g, "\\:");
}

/**
 * Escape a candidate value for use inside a `_describe` spec. `_describe`
 * splits each spec on the first unescaped `:` to separate value from
 * description, so any literal `:` in the value (URLs, namespaced ids) must
 * be backslash-escaped — and the escape itself must double up so the final
 * string interprets `\:` as a single literal.
 */
function escapeDescribeValue(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function zshExpandVar(fn: string, funcSuffix: string, fieldName: string): string {
  return `__${fn}_expand_${funcSuffix}__${sanitize(fieldName)}`;
}

/**
 * Encode a string as an ANSI-C zsh literal (`$'…'`) so newlines, the unit
 * separator key delimiter, and embedded `:` survive verbatim in the
 * generated table.
 */
function zshAnsiC(s: string): string {
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

interface ZshExpandLocation {
  funcSuffix: string;
  fieldName: string;
  /**
   * Enable runtime deduplication of already-consumed `key=` candidates
   * for repeatable array options (e.g. `-f workspaceId=foo -f <TAB>`
   * drops the `workspaceId=` slot). Always false for scalar options and
   * positionals.
   */
  isArrayOption: boolean;
}

/**
 * Generate zsh value completion lines for a ValueCompletion spec.
 * Uses `_vals` array (must be declared in the calling function scope).
 * `location` is required when `vc.type === "expand"`.
 */
function zshValueLines(
  vc: ValueCompletion | undefined,
  fn: string,
  location?: ZshExpandLocation,
): string[] {
  if (!vc) return [];
  switch (vc.type) {
    case "expand": {
      if (!location) {
        throw new Error("zshValueLines: expand variant requires a location");
      }
      const varName = zshExpandVar(fn, location.funcSuffix, location.fieldName);
      const depKey = vc.dependsOn.map((d) => `"\${_arg_values[${d}]:-}"`).join(`$'\\x1f'`);
      // _vals is split on newlines so each candidate can carry a `:desc`
      // suffix understood by `_describe`. Empty entries (from
      // unrecognised keys) are silently dropped by zsh's _describe.
      if (location.isArrayOption) {
        const bucket = sanitize(location.fieldName);
        return [
          `local _key=${depKey}`,
          `local _raw="\${${varName}[$_key]:-}"`,
          `if [[ -n "$_raw" ]]; then`,
          `    local -a _candidates=("\${(@f)_raw}")`,
          `    _vals=()`,
          `    local _c _ck`,
          `    for _c in "\${_candidates[@]}"; do`,
          `        if [[ "$_c" == *=* ]]; then`,
          `            _ck="\${_c%%=*}"`,
          `            if [[ -n "$_ck" && " \${_used_field_keys[${bucket}]:-} " == *" $_ck "* ]]; then continue; fi`,
          `        fi`,
          `        _vals+=("$_c")`,
          `    done`,
          `    __${fn}_cdescribe 'completions' _vals`,
          `fi`,
        ];
      }
      return [
        `local _key=${depKey}`,
        `local _raw="\${${varName}[$_key]:-}"`,
        `if [[ -n "$_raw" ]]; then`,
        `    _vals=("\${(@f)_raw}")`,
        `    __${fn}_cdescribe 'completions' _vals`,
        `fi`,
      ];
    }
    case "dynamic": {
      // Delegate to `<program> __complete --shell zsh` and let the apply
      // helper interpret the trailing `:<directive>` line so resolver-supplied
      // file/directory completion still reaches the shell. Slice `words` to
      // `CURRENT` (1-based, inclusive) so the resolver does not observe
      // tokens typed past the cursor — `parseCompletionContext` treats the
      // last argv element as the word being completed.
      return [
        `__${fn}_apply_dynamic_output "$(__${fn}_invoke_complete zsh "\${(@)words[2,CURRENT]}")"`,
      ];
    }
    case "choices": {
      const items = vc.choices!.map((c) => `"${escapeDesc(c)}"`).join(" ");
      return [`_vals=(${items})`, `__${fn}_cdescribe 'completions' _vals`];
    }
    case "file": {
      if (vc.matcher?.length) {
        return vc.matcher.map((p) => `_files -g "${p}"`);
      }
      if (vc.extensions?.length) {
        return vc.extensions.map((ext) => `_files -g "*.${ext}"`);
      }
      return [`_files`];
    }
    case "directory":
      return [`_files -/`];
    case "command":
      return [`_vals=("\${(@f)$(${vc.shellCommand!})}")`, `__${fn}_cdescribe 'completions' _vals`];
    case "none":
      return [];
  }
}

/** Generate option-value case branches */
function optionValueCases(options: CompletableOption[], fn: string, funcSuffix: string): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = zshValueLines(opt.valueCompletion, fn, {
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

    lines.push(`            ${patterns.join("|")})`);
    for (const vl of valLines) {
      lines.push(`                ${vl}`);
    }
    lines.push(`                return 0 ;;`);
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
      lines.push(`        ${pos.position}|*)`);
    } else {
      lines.push(`        ${pos.position})`);
    }
    const valLines = zshValueLines(pos.valueCompletion, fn, {
      funcSuffix,
      fieldName: pos.name,
      isArrayOption: false,
    });
    for (const vl of valLines) {
      lines.push(`            ${vl}`);
    }
    lines.push(`            ;;`);
  }
  lines.push(`    esac`);
  return lines;
}

/** Generate prev-word value completion case block */
function valueCompletionBlock(
  options: CompletableOption[],
  fn: string,
  funcSuffix: string,
): string[] {
  if (!options.some((o) => o.takesValue && o.valueCompletion)) return [];

  const prevCases = optionValueCases(options, fn, funcSuffix);
  if (prevCases.length === 0) return [];

  return [`    case "\${words[CURRENT-1]}" in`, ...prevCases, `    esac`];
}

/** Generate available-options list lines */
function availableOptionLines(options: CompletableOption[], fn: string): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    const desc = opt.description ? `:${escapeDesc(opt.description)}` : "";
    const negDesc = opt.negationDescription ? `:${escapeDesc(opt.negationDescription)}` : desc;
    if (opt.valueType === "array") {
      lines.push(`        _opts+=("--${opt.cliName}${desc}")`);
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
      lines.push(
        `        __${fn}_not_used ${patterns.join(" ")} && _opts+=("--${opt.cliName}${desc}")`,
      );
      if (opt.negation) {
        lines.push(
          `        __${fn}_not_used ${patterns.join(" ")} && _opts+=("--${opt.negation}${negDesc}")`,
        );
      }
    }
  }
  lines.push(`        __${fn}_not_used "--help" && _opts+=("--help:Show help")`);
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
  lines.push(`    local -a _vals=()`);

  // 1. Option value completion (prev word is value-taking option)
  lines.push(...valueCompletionBlock(sub.options, fn, funcSuffix));
  // Fallback: value-taking option without explicit completion → default file completion
  const fullPathStr = fullPath.join(":");
  lines.push(
    `    if __${fn}_opt_takes_value "${fullPathStr}" "\${words[CURRENT-1]}"; then return 0; fi`,
  );

  // 2. After -- separator
  if (sub.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(sub.positionals, fn, funcSuffix).map((l) => `    ${l}`));
    lines.push(`        return 0`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return 0; fi`);
  }

  // 3. Option name completion
  lines.push(`    if [[ "\${words[CURRENT]}" == -* ]]; then`);
  lines.push(`        local -a _opts=()`);
  lines.push(...availableOptionLines(sub.options, fn));
  lines.push(`        __${fn}_cdescribe 'options' _opts`);
  lines.push(`        return 0`);
  lines.push(`    fi`);

  // 4. Subcommand or positional completion (includes aliases)
  if (visibleSubs.length > 0) {
    const subItems = getSubNamesWithAliases(sub.subcommands)
      .map((s) => {
        const desc = s.description ? `:${escapeDesc(s.description)}` : "";
        return `"${s.name}${desc}"`;
      })
      .join(" ");
    lines.push(`    local -a _subs=(${subItems})`);
    lines.push(`    __${fn}_cdescribe 'subcommands' _subs`);
  } else if (sub.positionals.length > 0) {
    lines.push(...positionalBlock(sub.positionals, fn, funcSuffix));
  }

  lines.push(`}`);
  lines.push(``);
  return lines;
}

export function generateZshCompletion(
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
  const hasExpand = expandSpecs.length > 0;
  const arrayExpandSpecs = expandSpecs.filter((s) => s.isArrayOption);
  const hasArrayExpand = arrayExpandSpecs.length > 0;

  const lines: string[] = [];
  lines.push(`#compdef ${programName}`);
  lines.push(``);
  lines.push(`# Zsh completion for ${programName}`);
  lines.push(`# Generated by politty`);
  lines.push(``);

  // Expand-completion hoisted tables. One global associative array per
  // expand spec, populated via the array-literal form (which is the only
  // place where zsh evaluates `$'…'` for keys — subscripts treat the
  // quoted form as the literal string). Keys are `dependsOn` values
  // joined by U+001F; values are newline-separated `value:description`
  // entries consumed by `_describe`.
  for (const spec of expandSpecs) {
    const varName = `__${fn}_expand_${spec.funcSuffix}__${sanitize(spec.fieldName)}`;
    if (spec.vc.table.length === 0) {
      lines.push(`typeset -gA ${varName}=()`);
    } else {
      lines.push(`typeset -gA ${varName}=(`);
      for (const entry of spec.vc.table) {
        const key = entry.key.join("\x1f");
        const value = entry.candidates
          .map((c) => {
            const escapedValue = escapeDescribeValue(c.value);
            return c.description ? `${escapedValue}:${escapeDesc(c.description)}` : escapedValue;
          })
          .join("\n");
        lines.push(`    ${zshAnsiC(key)} ${zshAnsiC(value)}`);
      }
      lines.push(`)`);
    }
    lines.push(``);
  }

  // Dynamic completion delegate helpers (only when any value spec uses
  // an in-process JS resolver).
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
    lines.push(`    local _directive=0`);
    lines.push(`    local -a _vals _lines`);
    lines.push(`    _lines=("\${(@f)_raw}")`);
    // Only the trailing line is the directive sentinel; intermediate lines
    // starting with `:` are legitimate candidate values.
    lines.push(`    local _last=$#_lines`);
    lines.push(`    if (( _last >= 1 )) && [[ "\${_lines[$_last]}" == :<-> ]]; then`);
    lines.push(`        _directive="\${_lines[$_last]#:}"`);
    lines.push(`        _lines[$_last]=()`);
    lines.push(`    fi`);
    lines.push(`    local _l`);
    lines.push(`    for _l in "\${_lines[@]}"; do`);
    // Skip only blanks. The `@ext:`/`@matcher:` sentinels are produced by
    // the static shellCommand pipeline, not by dynamic resolvers — filtering
    // them here would silently drop resolver candidates that happen to
    // start with those literal strings.
    lines.push(`        [[ -z "$_l" ]] && continue`);
    lines.push(`        _vals+=("$_l")`);
    lines.push(`    done`);
    // Directive precedence mirrors bash: directory > file > value list.
    lines.push(`    if (( _directive & ${CompletionDirective.DirectoryCompletion} )); then`);
    lines.push(`        _files -/`);
    lines.push(`        return`);
    lines.push(`    fi`);
    lines.push(`    if (( _directive & ${CompletionDirective.FileCompletion} )); then`);
    lines.push(`        _files`);
    lines.push(`        return`);
    lines.push(`    fi`);
    lines.push(`    if (( \${#_vals[@]} > 0 )); then`);
    lines.push(`        __${fn}_cdescribe 'completions' _vals`);
    lines.push(`    fi`);
    lines.push(`}`);
    lines.push(``);
  }

  // Helper: check if option is already used
  lines.push(`__${fn}_not_used() {`);
  lines.push(`    local _u _chk`);
  lines.push(`    for _u in "\${_used_opts[@]}"; do`);
  lines.push(`        for _chk in "$@"; do`);
  lines.push(`            [[ "$_u" == "$_chk" ]] && return 1`);
  lines.push(`        done`);
  lines.push(`    done`);
  lines.push(`    return 0`);
  lines.push(`}`);
  lines.push(``);

  // Helper: _describe with compadd fallback
  // _describe may fail to add matches when prefix starts with - (zsh tag system limitation)
  lines.push(`__${fn}_cdescribe() {`);
  lines.push(`    _describe "$@" 2>/dev/null && return 0`);
  lines.push(`    shift`);
  lines.push(`    local -a _cd_vals=("\${(@)\${(P)1}%%:*}")`);
  lines.push(`    compadd -a _cd_vals 2>/dev/null`);
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
    // per-spec lookup can dispatch on sibling arg values.
    lines.push(`__${fn}_track_opt() {`);
    lines.push(`    case "$1:$2" in`);
    for (const t of trackedFields) {
      if (t.isPositional) continue;
      const patterns: string[] = [`--${t.cliName}`];
      for (const a of t.longAliases ?? []) patterns.push(`--${a}`);
      for (const a of t.shortAliases ?? []) patterns.push(`-${a}`);
      const joined = t.pathStrs.flatMap((p) => patterns.map((n) => `${p}:${n}`)).join("|");
      lines.push(`        ${joined}) _arg_values[${t.fieldName}]="$3" ;;`);
    }
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`__${fn}_track_pos() {`);
    lines.push(`    case "$1:$2" in`);
    for (const t of trackedFields) {
      if (!t.isPositional) continue;
      const joined = t.pathStrs.map((p) => `${p}:${t.position}`).join("|");
      lines.push(`        ${joined}) _arg_values[${t.fieldName}]="$3" ;;`);
    }
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
  }

  if (hasArrayExpand) {
    // Separate function from `__track_opt` so that an option that is
    // simultaneously a dependsOn target and an array expand host does
    // not collide on the same case pattern.
    lines.push(`__${fn}_track_array_expand() {`);
    lines.push(`    case "$1:$2" in`);
    for (const spec of arrayExpandSpecs) {
      const joined = spec.pathStrs
        .flatMap((p) => spec.optionTokens.map((tok) => `${p}:${tok}`))
        .join("|");
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
  // NOTE: Inline --opt=value completion is not yet supported in zsh; only
  // separate-word value completion (--opt <value>) is handled. Bash supports
  // inline via _inline_prefix parsing.
  lines.push(`__${fn}_complete_root() {`);
  lines.push(`    local -a _vals=()`);
  lines.push(...valueCompletionBlock(root.options, fn, "root"));
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(`    if __${fn}_opt_takes_value "" "\${words[CURRENT-1]}"; then return 0; fi`);
  if (root.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(root.positionals, fn, "root").map((l) => `    ${l}`));
    lines.push(`        return 0`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return 0; fi`);
  }
  lines.push(`    if [[ "\${words[CURRENT]}" == -* ]]; then`);
  lines.push(`        local -a _opts=()`);
  lines.push(...availableOptionLines(root.options, fn));
  lines.push(`        __${fn}_cdescribe 'options' _opts`);
  if (visibleSubs.length > 0) {
    lines.push(`    else`);
    const subItems = getSubNamesWithAliases(root.subcommands)
      .map((s) => {
        const desc = s.description ? `:${escapeDesc(s.description)}` : "";
        return `"${s.name}${desc}"`;
      })
      .join(" ");
    lines.push(`        local -a _subs=(${subItems})`);
    lines.push(`        __${fn}_cdescribe 'subcommands' _subs`);
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

  lines.push(`_${fn}() {`);
  lines.push(`    (( CURRENT )) || CURRENT=\${#words}`);
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
  lines.push(`    local _j=2`);
  lines.push(`    while (( _j < CURRENT )); do`);
  lines.push(`        local _w="\${words[_j]}"`);
  lines.push(`        if (( _skip_next )); then _skip_next=0; (( _j++ )); continue; fi`);
  lines.push(`        if [[ "$_w" == "--" ]]; then _after_dd=1; (( _j++ )); continue; fi`);
  if (hasExpand) {
    // After `--`, all remaining words are positionals. Track them so an
    // expand spec that depends on a positional still sees the value.
    lines.push(
      `        if (( _after_dd )); then __${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"; (( _pos_count++ )); (( _j++ )); continue; fi`,
    );
  } else {
    lines.push(`        if (( _after_dd )); then (( _pos_count++ )); (( _j++ )); continue; fi`);
  }
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
      lines.push(`                __${fn}_track_opt "$_subcmd" "$_w" "\${words[_j+1]:-}"`);
      lines.push(`                __${fn}_track_array_expand "$_subcmd" "$_w" "\${words[_j+1]:-}"`);
      lines.push(`            fi`);
    } else {
      lines.push(
        `            if __${fn}_opt_takes_value "$_subcmd" "$_w"; then _skip_next=1; __${fn}_track_opt "$_subcmd" "$_w" "\${words[_j+1]:-}"; fi`,
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
  lines.push(
    `zstyle ':completion:*:*:${programName}:*' file-patterns '%p:globbed-files *(-/):directories'`,
  );
  lines.push(``);
  lines.push(`compdef _${fn} ${programName}`);
  lines.push(``);

  return {
    script: lines.join("\n"),
    shell: "zsh",
    installInstructions: `# To enable completions, add the following to your ~/.zshrc:

# Option 1: Source directly (add before compinit)
eval "$(${programName} completion zsh)"

# Option 2: Save to a file in your fpath
${programName} completion zsh > ~/.zsh/completions/_${programName}

# Make sure your fpath includes the completions directory:
# fpath=(~/.zsh/completions $fpath)
# autoload -Uz compinit && compinit

# Then reload your shell or run:
source ~/.zshrc`,
  };
}
