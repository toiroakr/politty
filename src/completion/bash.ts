/**
 * Bash completion script generator (static)
 *
 * Generates a self-contained bash completion script that embeds all
 * completion metadata. No Node.js process is spawned on TAB.
 */

import type { AnyCommand } from "../types.js";
import { extractCompletionData } from "./extractor.js";
import type {
  CompletableOption,
  CompletablePositional,
  CompletableSubcommand,
  CompletionOptions,
  CompletionResult,
  ValueCompletion,
} from "./types.js";

function sanitize(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "_");
}

/** Escape a string for use inside bash double-quotes */
function escapeBashDQ(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$").replace(/`/g, "\\`");
}

/**
 * Generate bash value completion code for a ValueCompletion spec.
 * Returns an array of bash lines.
 */
function bashValueLines(vc: ValueCompletion | undefined, inline: boolean): string[] {
  if (!vc) return [];

  switch (vc.type) {
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
      if (vc.extensions?.length) {
        return bashExtensionFilter(vc.extensions, inline);
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

function bashExtensionFilter(extensions: string[], inline: boolean): string[] {
  const checks = extensions.map((ext) => `[[ "$_f" == *".${ext}" ]]`).join(" || ");
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
function optionValueCases(options: CompletableOption[], inline: boolean): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = bashValueLines(opt.valueCompletion, inline);
    if (valLines.length === 0) continue;

    const patterns: string[] = [`--${opt.cliName}`];
    if (opt.alias) patterns.push(`-${opt.alias}`);
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
function positionalBlock(positionals: CompletablePositional[]): string[] {
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
    for (const vl of bashValueLines(pos.valueCompletion, false)) {
      lines.push(`            ${vl}`);
    }
    lines.push(`            ;;`);
  }

  lines.push(`    esac`);
  return lines;
}

/**
 * Generate a per-subcommand completion function.
 * Recursively generates functions for nested subcommands.
 */
function generateSubHandler(sub: CompletableSubcommand, fn: string, path: string[]): string[] {
  const fullPath = [...path, sub.name];
  const funcName = `__${fn}_complete_${fullPath.map(sanitize).join("_")}`;
  const visibleSubs = sub.subcommands.filter((s) => !s.name.startsWith("__"));
  const valueTakingOpts = sub.options.filter((o) => o.takesValue && o.valueCompletion);

  const lines: string[] = [];

  // Recursively generate handlers for child subcommands
  for (const child of visibleSubs) {
    lines.push(...generateSubHandler(child, fn, fullPath));
  }

  lines.push(`${funcName}() {`);

  // 1. Option value completion (prev is value-taking option)
  if (valueTakingOpts.length > 0) {
    const prevCases = optionValueCases(sub.options, false);
    if (prevCases.length > 0) {
      lines.push(`    if [[ -z "$_inline_prefix" ]]; then`);
      lines.push(`        case "$_prev" in`);
      lines.push(...prevCases);
      lines.push(`        esac`);
      lines.push(`    fi`);
    }

    // 2. Inline value completion (--opt=val)
    const inlineCases = optionValueCases(sub.options, true);
    if (inlineCases.length > 0) {
      lines.push(`    if [[ -n "$_inline_prefix" ]]; then`);
      lines.push(`        case "\${_inline_prefix%=}" in`);
      lines.push(...inlineCases);
      lines.push(`        esac`);
      lines.push(`    fi`);
    }
  }

  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(
    `    if [[ -z "$_inline_prefix" ]] && __${fn}_opt_takes_value "${sub.name}" "$_prev"; then return; fi`,
  );
  lines.push(
    `    if [[ -n "$_inline_prefix" ]] && __${fn}_opt_takes_value "${sub.name}" "\${_inline_prefix%=}"; then return; fi`,
  );

  // 3. After -- separator
  if (sub.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(sub.positionals).map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return; fi`);
  }

  // 4. Option name completion
  lines.push(`    if [[ "$_cur" == -* ]]; then`);
  lines.push(`        local -a _avail=()`);
  for (const opt of sub.options) {
    if (opt.valueType === "array") {
      // Array options can be specified multiple times — always keep available
      lines.push(`        _avail+=(--${opt.cliName})`);
    } else {
      const patterns: string[] = [`"--${opt.cliName}"`];
      if (opt.alias) patterns.push(`"-${opt.alias}"`);
      lines.push(`        __${fn}_not_used ${patterns.join(" ")} && _avail+=(--${opt.cliName})`);
    }
  }
  lines.push(`        __${fn}_not_used "--help" && _avail+=(--help)`);
  lines.push(`        COMPREPLY=($(compgen -W "\${_avail[*]}" -- "$_cur"))`);
  lines.push(`        compopt +o default 2>/dev/null`);
  lines.push(`        return`);
  lines.push(`    fi`);

  // 5. Subcommand or positional completion
  if (visibleSubs.length > 0) {
    const subNames = visibleSubs.map((s) => s.name).join(" ");
    lines.push(`    COMPREPLY=($(compgen -W "${subNames}" -- "$_cur"))`);
    lines.push(`    compopt +o default 2>/dev/null`);
  } else if (sub.positionals.length > 0) {
    lines.push(...positionalBlock(sub.positionals));
  }

  lines.push(`}`);
  lines.push(``);
  return lines;
}

/** Generate opt-takes-value helper entries for a subcommand tree */
function optTakesValueEntries(sub: CompletableSubcommand, subcmdName: string): string[] {
  const lines: string[] = [];
  for (const opt of sub.options) {
    if (opt.takesValue) {
      const patterns: string[] = [`${subcmdName}:--${opt.cliName}`];
      if (opt.alias) patterns.push(`${subcmdName}:-${opt.alias}`);
      lines.push(`        ${patterns.join("|")}) return 0 ;;`);
    }
  }
  // Recurse into child subcommands
  for (const child of sub.subcommands) {
    if (!child.name.startsWith("__")) {
      lines.push(...optTakesValueEntries(child, child.name));
    }
  }
  return lines;
}

export function generateBashCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  const data = extractCompletionData(command, options.programName);
  const fn = sanitize(options.programName);
  const root = data.command;
  const visibleSubs = root.subcommands.filter((s) => !s.name.startsWith("__"));

  const lines: string[] = [];
  lines.push(`# Bash completion for ${options.programName}`);
  lines.push(`# Generated by politty`);
  lines.push(``);

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

  // Per-subcommand completion functions
  for (const sub of visibleSubs) {
    lines.push(...generateSubHandler(sub, fn, []));
  }

  // Root handler
  const rootValueOpts = root.options.filter((o) => o.takesValue && o.valueCompletion);
  lines.push(`__${fn}_complete_root() {`);
  if (rootValueOpts.length > 0) {
    const prevCases = optionValueCases(root.options, false);
    if (prevCases.length > 0) {
      lines.push(`    if [[ -z "$_inline_prefix" ]]; then`);
      lines.push(`        case "$_prev" in`);
      lines.push(...prevCases);
      lines.push(`        esac`);
      lines.push(`    fi`);
    }
    const inlineCases = optionValueCases(root.options, true);
    if (inlineCases.length > 0) {
      lines.push(`    if [[ -n "$_inline_prefix" ]]; then`);
      lines.push(`        case "\${_inline_prefix%=}" in`);
      lines.push(...inlineCases);
      lines.push(`        esac`);
      lines.push(`    fi`);
    }
  }
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(
    `    if [[ -z "$_inline_prefix" ]] && __${fn}_opt_takes_value "" "$_prev"; then return; fi`,
  );
  lines.push(
    `    if [[ -n "$_inline_prefix" ]] && __${fn}_opt_takes_value "" "\${_inline_prefix%=}"; then return; fi`,
  );
  if (root.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(root.positionals).map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return; fi`);
  }
  lines.push(`    if [[ "$_cur" == -* ]]; then`);
  lines.push(`        local -a _avail=()`);
  for (const opt of root.options) {
    if (opt.valueType === "array") {
      lines.push(`        _avail+=(--${opt.cliName})`);
    } else {
      const patterns: string[] = [`"--${opt.cliName}"`];
      if (opt.alias) patterns.push(`"-${opt.alias}"`);
      lines.push(`        __${fn}_not_used ${patterns.join(" ")} && _avail+=(--${opt.cliName})`);
    }
  }
  lines.push(`        __${fn}_not_used "--help" && _avail+=(--help)`);
  lines.push(`        COMPREPLY=($(compgen -W "\${_avail[*]}" -- "$_cur"))`);
  lines.push(`        compopt +o default 2>/dev/null`);
  if (visibleSubs.length > 0) {
    lines.push(`    else`);
    const subNames = visibleSubs.map((s) => s.name).join(" ");
    lines.push(`        COMPREPLY=($(compgen -W "${subNames}" -- "$_cur"))`);
    lines.push(`        compopt +o default 2>/dev/null`);
  } else if (root.positionals.length > 0) {
    lines.push(`    else`);
    lines.push(...positionalBlock(root.positionals).map((l) => `    ${l}`));
  }
  lines.push(`    fi`);
  lines.push(`}`);
  lines.push(``);

  // Main completion function
  const subRouting = visibleSubs
    .map((s) => `        ${s.name}) __${fn}_complete_${sanitize(s.name)} ;;`)
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
  lines.push(``);
  lines.push(`    local _j=0`);
  lines.push(`    while (( _j < \${#_words[@]} - 1 )); do`);
  lines.push(`        local _w="\${_words[_j]}"`);
  lines.push(`        if (( _skip_next )); then _skip_next=0; (( _j++ )); continue; fi`);
  lines.push(`        if [[ "$_w" == "--" ]]; then _after_dd=1; (( _j++ )); continue; fi`);
  lines.push(`        if (( _after_dd )); then (( _pos_count++ )); (( _j++ )); continue; fi`);
  lines.push(
    `        if [[ "$_w" == --*=* ]]; then _used_opts+=("\${_w%%=*}"); (( _j++ )); continue; fi`,
  );
  lines.push(`        if [[ "$_w" == -* ]]; then`);
  lines.push(`            _used_opts+=("$_w")`);
  lines.push(`            __${fn}_opt_takes_value "$_subcmd" "$_w" && _skip_next=1`);
  lines.push(`            (( _j++ )); continue`);
  lines.push(`        fi`);
  // NOTE: Only first-level subcommand dispatch is supported. Nested subcommand
  // handlers are generated but not yet dispatched (requires multi-level word parsing).
  if (visibleSubs.length > 0) {
    lines.push(
      `        if [[ -z "$_subcmd" ]]; then _subcmd="$_w"; _used_opts=(); else (( _pos_count++ )); fi`,
    );
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
  lines.push(`complete -o default -F _${fn}_completions ${options.programName}`);
  lines.push(``);

  const { programName } = options;

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
