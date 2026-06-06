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
  dynamicInvokeCompleteLines,
  effectiveOptionTokens,
  expandTableVarName,
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
import { buildHeaderLines } from "./header.js";
import { generateZshSelfRefresh } from "./self-refresh.js";
import {
  ansiC,
  optionExpandLocation,
  positionalExpandLocation,
  quotedAvailabilityTokens,
  type FuncSuffixedExpandLocation,
} from "./shell-shared.js";
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

/** Escape a string for use inside zsh double-quotes. */
function escapeZshDQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

function zshArrayLiteral(values: readonly string[]): string {
  return values.map((v) => `"${escapeZshDQ(v)}"`).join(" ");
}

function zshFilteredFileLines(
  fn: string,
  kind: "extensions" | "matchers",
  values: readonly string[],
): string[] {
  const arrayName = kind === "extensions" ? "_exts" : "_matchers";
  const lines = [
    `setopt local_options null_glob`,
    `local _cur="\${words[CURRENT]:-}" _dir _prefix _f _out`,
    `local -a ${arrayName}=(${zshArrayLiteral(values)})`,
    `if [[ -z "$_cur" || "$_cur" != */* ]]; then`,
    `    _dir="."`,
    `    _prefix="$_cur"`,
    `elif [[ "$_cur" == */ ]]; then`,
    `    _dir="\${_cur%/}"`,
    `    _prefix=""`,
    `else`,
    `    _dir="\${_cur%/*}"`,
    `    _prefix="\${_cur##*/}"`,
    `fi`,
    `for _f in "$_dir"/"$_prefix"*(N/); do`,
    `    _out="\${_f#./}"`,
    `    __${fn}_add_path_candidate "$_out"`,
    `done`,
  ];
  if (kind === "extensions") {
    lines.push(`local _ext`);
    lines.push(`for _ext in "\${_exts[@]}"; do`);
    lines.push(`    [[ -n "$_ext" ]] || continue`);
    lines.push(`    for _f in "$_dir"/"$_prefix"*."$_ext"(N.); do`);
    lines.push(`        _out="\${_f#./}"`);
    lines.push(`        __${fn}_add_path_candidate "$_out"`);
    lines.push(`    done`);
    lines.push(`done`);
  } else {
    lines.push(`local _pat`);
    lines.push(`for _pat in "\${_matchers[@]}"; do`);
    lines.push(`    [[ -n "$_pat" ]] || continue`);
    lines.push(`    for _f in "$_dir"/\${~_pat}(N.); do`);
    lines.push(`        _out="\${_f#./}"`);
    lines.push(`        [[ "$_out" == "$_cur"* ]] && __${fn}_add_path_candidate "$_out"`);
    lines.push(`    done`);
    lines.push(`done`);
  }
  return lines;
}

/**
 * Generate zsh value completion lines for a ValueCompletion spec.
 * Uses `_vals` array (must be declared in the calling function scope).
 * `location` is required when `vc.type === "expand"`.
 */
function zshValueLines(
  vc: ValueCompletion | undefined,
  fn: string,
  location?: FuncSuffixedExpandLocation,
): string[] {
  if (!vc) return [];
  switch (vc.type) {
    case "expand": {
      if (!location) {
        throw new Error("zshValueLines: expand variant requires a location");
      }
      const varName = expandTableVarName(fn, location.funcSuffix, location.fieldName);
      // Per-dep lookups read from the matching bucket: globals from
      // `_global_arg_values` (preserved across subcommand descent) and
      // locals from `_arg_values` (cleared on descent).
      const depKey = location.resolvedDeps
        .map((d) =>
          d.isGlobal ? `"\${_global_arg_values[${d.name}]:-}"` : `"\${_arg_values[${d.name}]:-}"`,
        )
        .join(`$'\\x1f'`);
      // _vals is split on newlines so each candidate can carry a `:desc`
      // suffix understood by `_describe`. Empty entries (from
      // unrecognised keys) are silently dropped by zsh's _describe.
      // Two-stage `key=value`: when the user has not typed `=` yet,
      // collapse every `key=value` candidate to a unique `key=` so the
      // first TAB picks the key. The second TAB (after `key=`) keeps the
      // full `key=value` candidates so the user picks the value. Array-host
      // dedup against already-typed keys runs before the collapse so a
      // used key stays hidden at both stages.
      const bucket = sanitize(location.fieldName);
      const bucketRef = location.isGlobal
        ? `\${_global_used_field_keys[${bucket}]:-}`
        : `\${_used_field_keys[${bucket}]:-}`;
      const arrayDedupLines = location.isArrayOption
        ? [`            if [[ -n "$_ck" && " ${bucketRef} " == *" $_ck "* ]]; then continue; fi`]
        : [];
      return [
        `local _key=${depKey}`,
        `local _raw="\${${varName}[$_key]:-}"`,
        `if [[ -n "$_raw" ]]; then`,
        `    local -a _candidates=("\${(@f)_raw}")`,
        `    _vals=()`,
        `    local _c _ck _cke _vp _seen_keys=" " _desc _has_eq=0 _tmp`,
        `    for _c in "\${_candidates[@]}"; do`,
        // Replace escaped `\:` with a sentinel byte (0x01, never present
        // in real candidate text) so the value/description split at the
        // first UNESCAPED `:` survives values that contain literal `:`
        // (e.g. `ns:key=value`).
        `        _tmp="\${_c//\\\\:/$'\\x01'}"`,
        // Inspect only the VALUE portion when deciding key=value. A
        // candidate like `{value: "region", description: "format a=b"}`
        // surfaces as `region:format a=b`, and a naive `$_c == *=*`
        // would route it through the key=value branch on the
        // description alone.
        `        _vp="\${_tmp%%:*}"`,
        `        if [[ "$_vp" == *=* ]]; then`,
        // Two forms of the key: the ESCAPED `_cke` keeps `\:` intact for
        // rebuilding `_c` so `_describe`'s value:description split sees
        // the right boundary; the UNESCAPED `_ck` (`\:` → `:`) is what
        // the tracker recorded into `_used_field_keys` and what the
        // dedup checks need to match.
        `            _cke="\${_c%%=*}"`,
        `            _ck="\${_cke//\\\\:/:}"`,
        ...arrayDedupLines,
        `            if [[ "\${words[CURRENT]}" != *=* ]]; then`,
        `                [[ "$_seen_keys" == *" $_ck "* ]] && continue`,
        `                _seen_keys+="$_ck "`,
        `                if [[ "$_tmp" == *:* ]]; then`,
        // Extract desc from after the first UNESCAPED `:` (via `_tmp`),
        // then restore the sentinel to `\:` so a literal colon inside
        // the description survives intact.
        `                    _desc="\${\${_tmp#*:}//$'\\x01'/\\\\:}"`,
        `                    _c="\${_cke}=:$_desc"`,
        `                else`,
        `                    _c="\${_cke}="`,
        `                fi`,
        // Key-stage candidates always end with `=`, so `_describe` needs
        // `-S ''` to skip the trailing space and let the user type the
        // value after TAB. Mark the flag here instead of inferring it
        // from \`_tmp\` — `enumerate` may return only `key=value`
        // candidates, which fold to `key=` only in `_c`.
        `                _has_eq=1`,
        `            else`,
        // Value stage: drop bare `key=` candidates so they do not clutter
        // the value picker. `_vp` is the value-portion of `_tmp` (already
        // computed above) — split at the first UNESCAPED `:`.
        `                [[ "$_vp" == *=?* ]] || continue`,
        `            fi`,
        `        fi`,
        `        _vals+=("$_c")`,
        `    done`,
        `    if (( _has_eq )); then`,
        `        __${fn}_cdescribe 'completions' _vals -S ''`,
        `    else`,
        `        __${fn}_cdescribe 'completions' _vals`,
        `    fi`,
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
        return zshFilteredFileLines(fn, "matchers", vc.matcher);
      }
      if (vc.extensions?.length) {
        return zshFilteredFileLines(fn, "extensions", vc.extensions);
      }
      return [`_files`];
    }
    case "directory":
      return [`_files -/`];
    case "command":
      return [`_vals=("\${(@f)$(${vc.shellCommand!})}")`, `__${fn}_cdescribe 'completions' _vals`];
    case "none":
      return [];
    case "runtime-expand":
      return [];
  }
}

/** Generate option-value case branches */
function optionValueCases(
  options: CompletableOption[],
  positionals: readonly CompletablePositional[],
  fn: string,
  funcSuffix: string,
): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = zshValueLines(opt.valueCompletion, fn, {
      funcSuffix,
      ...optionExpandLocation(opt, options, positionals),
    });
    if (valLines.length === 0) continue;

    const patterns = effectiveOptionTokens(opt, options);
    // An option whose every emitted spelling is shadowed by siblings at
    // this frame has nothing to pattern-match on. Emitting an empty
    // `)` branch would break the surrounding case.
    if (patterns.length === 0) continue;

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
  options: readonly CompletableOption[] = [],
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
      ...positionalExpandLocation(pos, options, positionals),
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
  positionals: readonly CompletablePositional[],
  fn: string,
  funcSuffix: string,
): string[] {
  if (!options.some((o) => o.takesValue && o.valueCompletion)) return [];

  const prevCases = optionValueCases(options, positionals, fn, funcSuffix);
  if (prevCases.length === 0) return [];

  return [`    case "\${words[CURRENT-1]}" in`, ...prevCases, `    esac`];
}

/** Generate available-options list lines */
function availableOptionLines(options: CompletableOption[], fn: string): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    const desc = opt.description ? `:${escapeDesc(opt.description)}` : "";
    if (opt.valueType === "array") {
      lines.push(`        _opts+=("--${opt.cliName}${desc}")`);
      continue;
    }
    const patterns = quotedAvailabilityTokens(opt.cliName, opt.alias, opt.negation, {
      isGlobal: opt.isGlobal === true,
      frameOptions: options,
    });
    const guard = `__${fn}_not_used ${patterns.join(" ")}`;
    const negDesc = opt.negationDescription ? `:${escapeDesc(opt.negationDescription)}` : desc;
    const entries: Array<{ name: string; desc: string }> = [{ name: opt.cliName, desc }];
    if (opt.negation) entries.push({ name: opt.negation, desc: negDesc });
    for (const e of entries) {
      // Skip the suggestion when `--name`'s long form was filtered out
      // of the routing-aware token set — emitting it would point the
      // user at an option the runtime routes elsewhere.
      if (!patterns.includes(`"--${e.name}"`)) continue;
      lines.push(`        ${guard} && _opts+=("--${e.name}${e.desc}")`);
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
  lines.push(...valueCompletionBlock(sub.options, sub.positionals, fn, funcSuffix));
  // Fallback: value-taking option without explicit completion → default file completion
  const fullPathStr = fullPath.join(":");
  lines.push(
    `    if __${fn}_opt_takes_value "${fullPathStr}" "\${words[CURRENT-1]}"; then return 0; fi`,
  );

  // 2. After -- separator
  if (sub.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(
      ...positionalBlock(sub.positionals, fn, funcSuffix, sub.options).map((l) => `    ${l}`),
    );
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
    lines.push(...positionalBlock(sub.positionals, fn, funcSuffix, sub.options));
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
  const baseFn = sanitize(programName);
  const fn = options.staticWorker
    ? `${baseFn}_${sanitize(options.staticWorker.functionSuffix)}`
    : baseFn;
  const isWorker = options.staticWorker !== undefined;
  const completionFn = isWorker ? `_${fn}_completions` : `_${programName}`;
  const autoloadCheck = `"\${funcstack[1]:-}" == "${escapeZshDQ(completionFn)}"`;
  const root = data.command;
  const visibleSubs = getVisibleSubs(root.subcommands);
  const expandSpecs = collectExpandSpecs(root);
  const trackedFields = collectTrackedFields(root, expandSpecs, data.globalOptions);
  const hasExpand = expandSpecs.length > 0;
  const arrayExpandSpecs = expandSpecs.filter((s) => s.isArrayOption);
  const hasArrayExpand = arrayExpandSpecs.length > 0;

  const lines: string[] = [];
  if (!isWorker) {
    lines.push(`#compdef ${programName}`);
    lines.push(``);
  }
  lines.push(
    ...buildHeaderLines({
      programName,
      shell: "zsh",
      binPath: options.binPath,
      programVersion: options.programVersion,
    }),
  );
  lines.push(`# politty-completion-mode: static`);
  if (isWorker) lines.push(`# politty-completion-worker: true`);
  lines.push(`# Generated by politty`);
  lines.push(``);
  if (!isWorker) {
    lines.push(...generateZshSelfRefresh({ programName, binPath: options.binPath }));
  }

  // Expand-completion hoisted tables. One global associative array per
  // expand spec, populated via the array-literal form (which is the only
  // place where zsh evaluates `$'…'` for keys — subscripts treat the
  // quoted form as the literal string). Keys are `dependsOn` values
  // joined by U+001F; values are newline-separated `value:description`
  // entries consumed by `_describe`.
  for (const spec of expandSpecs) {
    const varName = expandTableVarName(fn, spec.funcSuffix, spec.fieldName);
    if (spec.vc.table.length === 0) {
      lines.push(`typeset -gA ${varName}=()`);
    } else {
      lines.push(`typeset -gA ${varName}=(`);
      for (const entry of spec.vc.table) {
        const key = entry.key.join("\x1f");
        const value = entry.candidates
          .map((c) => {
            const escapedValue = escapeDescribeValue(c.value);
            // The whole `value:description` line is wrapped in `ansiC(...)`,
            // which handles shell-level escaping. `_describe` consumes only
            // the first unescaped `:` to split value/description, so the
            // description tail does not need any additional escaping —
            // applying the double-quoted-string escaper here would leak
            // backslashes for `$`, `"`, `` ` ``, and `:` into the rendered
            // completion UI (e.g. `cost $5` becoming `cost \$5`).
            return c.description ? `${escapedValue}:${c.description}` : escapedValue;
          })
          .join("\n");
        lines.push(`    ${ansiC(key)} ${ansiC(value)}`);
      }
      lines.push(`)`);
    }
    lines.push(``);
  }

  // Dynamic completion delegate helpers (only when any value spec uses
  // an in-process JS resolver).
  if (hasDynamicCompletion(root)) {
    lines.push(...dynamicInvokeCompleteLines(fn, programName));
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
    // Emit resolver candidates first, then layer on filesystem completion
    // when the resolver requested it. `_files` adds to the candidate list
    // rather than replacing it, so a resolver returning both names and
    // `FileCompletion` shows both — matching the bash/fish behaviour. When
    // the resolver flags NoSpace (e.g. `key=` candidates that the user
    // should keep typing past), forward `-S ''` to compadd so zsh does
    // not append the default trailing space.
    lines.push(`    if (( \${#_vals[@]} > 0 )); then`);
    lines.push(`        if (( _directive & ${CompletionDirective.NoSpace} )); then`);
    lines.push(`            __${fn}_cdescribe 'completions' _vals -S ''`);
    lines.push(`        else`);
    lines.push(`            __${fn}_cdescribe 'completions' _vals`);
    lines.push(`        fi`);
    lines.push(`    fi`);
    lines.push(`    if (( _directive & ${CompletionDirective.DirectoryCompletion} )); then`);
    lines.push(`        _files -/`);
    lines.push(`    elif (( _directive & ${CompletionDirective.FileCompletion} )); then`);
    lines.push(`        _files`);
    // Default directive (0) with no resolver candidates: fall back to
    // the documented filename completion, matching the bash apply
    // helper. Without this, an empty `Default` result silently leaves
    // the caller's `return 0` to suppress any file fallback.
    lines.push(
      `    elif (( \${#_vals[@]} == 0 )) && ! (( _directive & ${CompletionDirective.NoFileCompletion} )); then`,
    );
    lines.push(`        _files`);
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
  // _describe may fail to add matches when prefix starts with - (zsh tag
  // system limitation). When that happens we still want any trailing
  // compadd-pass-through options (e.g. `-S ''` for NoSpace) to reach
  // compadd so two-stage `key=` candidates keep their suffix behaviour.
  lines.push(`__${fn}_cdescribe() {`);
  lines.push(`    _describe "$@" 2>/dev/null && return 0`);
  lines.push(`    shift`);
  lines.push(`    local _cd_arr="$1"`);
  lines.push(`    shift`);
  lines.push(`    local -a _cd_vals=("\${(@)\${(P)_cd_arr}%%:*}")`);
  lines.push(`    compadd "$@" -a _cd_vals 2>/dev/null`);
  lines.push(`    return 0`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`__${fn}_add_path_candidate() {`);
  lines.push(`    compadd -f -- "$1" 2>/dev/null && return 0`);
  lines.push(`    print -r -- "$1"`);
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
    lines.push(...trackOptCaseLines(trackedFields, "zsh"));
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
    lines.push(`__${fn}_track_pos() {`);
    lines.push(`    case "$1:$2" in`);
    lines.push(...trackPosCaseLines(trackedFields, "zsh"));
    lines.push(`    esac`);
    lines.push(`}`);
    lines.push(``);
  }

  if (hasArrayExpand) {
    // Separate function from `__track_opt` so an option that is
    // simultaneously a dependsOn target and an array expand host does
    // not collide on the same case pattern.
    lines.push(`__${fn}_track_array_expand() {`);
    lines.push(`    case "$1:$2" in`);
    lines.push(...trackArrayExpandCaseLines(arrayExpandSpecs, "zsh"));
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
  lines.push(...valueCompletionBlock(root.options, root.positionals, fn, "root"));
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(`    if __${fn}_opt_takes_value "" "\${words[CURRENT-1]}"; then return 0; fi`);
  if (root.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(
      ...positionalBlock(root.positionals, fn, "root", root.options).map((l) => `    ${l}`),
    );
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
    lines.push(
      ...positionalBlock(root.positionals, fn, "root", root.options).map((l) => `    ${l}`),
    );
  }
  lines.push(`    fi`);
  lines.push(`}`);
  lines.push(``);

  // Main completion function -- subcommand dispatch routing
  const subRouting = subDispatchCaseLines(routeEntries, fn).join("\n");

  lines.push(`${completionFn}() {`);
  lines.push(`    (( CURRENT )) || CURRENT=\${#words}`);
  lines.push(``);
  lines.push(`    local _subcmd="" _after_dd=0 _pos_count=0 _skip_next=0`);
  lines.push(`    local -a _used_opts=()`);
  if (hasExpand) {
    lines.push(`    local -A _arg_values=()`);
    // Globals survive subcommand descent so values supplied before the
    // subcommand (e.g. `cli --env prod sub --field <TAB>`) remain visible.
    lines.push(`    local -A _global_arg_values=()`);
  }
  if (hasArrayExpand) {
    lines.push(`    local -A _used_field_keys=()`);
    lines.push(`    local -A _global_used_field_keys=()`);
    lines.push(`    local -A _global_arr_seen=()`);
  }
  lines.push(``);
  lines.push(`    local _j=2`);
  lines.push(`    while (( _j < CURRENT )); do`);
  lines.push(`        local _w="\${words[_j]}"`);
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
  // option, not this option's value. Skip/track only when the next
  // token looks like a value.
  lines.push(`            if __${fn}_opt_takes_value "$_subcmd" "$_w"; then`);
  lines.push(`                local _next="\${words[_j+1]:-}"`);
  lines.push(`                if [[ -n "$_next" && "$_next" != -* ]]; then _skip_next=1; fi`);
  if (hasExpand) {
    lines.push(`                if (( _skip_next )); then`);
    lines.push(`                    __${fn}_track_opt "$_subcmd" "$_w" "$_next"`);
    if (hasArrayExpand) {
      lines.push(`                    if (( _j + 1 < CURRENT )); then`);
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
  const clearState = hasArrayExpand
    ? `; _arg_values=(); _used_field_keys=(); _global_arr_seen=()`
    : hasExpand
      ? `; _arg_values=()`
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
  lines.push(
    `zstyle ':completion:*:*:${programName}:*' file-patterns '%p:globbed-files *(-/):directories'`,
  );
  lines.push(``);
  if (!isWorker) {
    lines.push(`if [[ ${autoloadCheck} ]]; then`);
    lines.push(`    ${completionFn} "$@"`);
    lines.push(`else`);
    lines.push(`    compdef ${completionFn} ${programName}`);
    lines.push(`fi`);
    lines.push(``);
  }

  return {
    script: lines.join("\n"),
    shell: "zsh",
    installInstructions: `# To enable auto-refreshing zsh completions, add this to your ~/.zshrc after compinit:
eval "$(${programName} completion zsh)"

# For faster shell startup, save the script in your fpath:
mkdir -p ~/.zsh/completions
${programName} completion zsh > ~/.zsh/completions/_${programName}

# Make sure your ~/.zshrc includes the fpath line before compinit:
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit

# If ~/.zshrc already calls compinit, add only the fpath line before
# the existing compinit call.

# Then reload your shell or run:
source ~/.zshrc`,
  };
}
