/**
 * Zsh completion script generator (static)
 *
 * Generates a self-contained zsh completion script that embeds all
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

function escapeDesc(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/:/g, "\\:");
}

/**
 * Generate zsh value completion lines for a ValueCompletion spec.
 * Uses `_vals` array (must be declared in the calling function scope).
 */
function zshValueLines(vc: ValueCompletion | undefined, fn: string): string[] {
  if (!vc) return [];
  switch (vc.type) {
    case "choices": {
      const items = vc.choices!.map((c) => `"${c}"`).join(" ");
      return [`_vals=(${items})`, `__${fn}_cdescribe 'completions' _vals`];
    }
    case "file": {
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
function optionValueCases(options: CompletableOption[], fn: string): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = zshValueLines(opt.valueCompletion, fn);
    if (valLines.length === 0) continue;

    const patterns: string[] = [`--${opt.cliName}`];
    if (opt.alias) patterns.push(`-${opt.alias}`);

    lines.push(`            ${patterns.join("|")})`);
    for (const vl of valLines) {
      lines.push(`                ${vl}`);
    }
    lines.push(`                return 0 ;;`);
  }
  return lines;
}

/** Generate positional completion block */
function positionalBlock(positionals: CompletablePositional[], fn: string): string[] {
  if (positionals.length === 0) return [];
  const lines: string[] = [];
  lines.push(`    case "$_pos_count" in`);
  for (const pos of positionals) {
    if (pos.variadic) {
      lines.push(`        ${pos.position}|*)`);
    } else {
      lines.push(`        ${pos.position})`);
    }
    const valLines = zshValueLines(pos.valueCompletion, fn);
    for (const vl of valLines) {
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
  lines.push(`    local -a _vals=()`);

  // 1. Option value completion (prev word is value-taking option)
  if (valueTakingOpts.length > 0) {
    const prevCases = optionValueCases(sub.options, fn);
    if (prevCases.length > 0) {
      lines.push(`    case "\${words[CURRENT-1]}" in`);
      lines.push(...prevCases);
      lines.push(`    esac`);
    }
  }
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(
    `    if __${fn}_opt_takes_value "${sub.name}" "\${words[CURRENT-1]}"; then return 0; fi`,
  );

  // 2. After -- separator
  if (sub.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(sub.positionals, fn).map((l) => `    ${l}`));
    lines.push(`        return 0`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return 0; fi`);
  }

  // 3. Option name completion
  lines.push(`    if [[ "\${words[CURRENT]}" == -* ]]; then`);
  lines.push(`        local -a _opts=()`);
  for (const opt of sub.options) {
    const desc = opt.description ? `:${escapeDesc(opt.description)}` : "";
    if (opt.valueType === "array") {
      lines.push(`        _opts+=("--${opt.cliName}${desc}")`);
    } else {
      const patterns: string[] = [`"--${opt.cliName}"`];
      if (opt.alias) patterns.push(`"-${opt.alias}"`);
      lines.push(
        `        __${fn}_not_used ${patterns.join(" ")} && _opts+=("--${opt.cliName}${desc}")`,
      );
    }
  }
  lines.push(`        __${fn}_not_used "--help" && _opts+=("--help:Show help")`);
  lines.push(`        __${fn}_cdescribe 'options' _opts`);
  lines.push(`        return 0`);
  lines.push(`    fi`);

  // 4. Subcommand or positional completion
  if (visibleSubs.length > 0) {
    const subItems = visibleSubs
      .map((s) => {
        const desc = s.description ? `:${escapeDesc(s.description)}` : "";
        return `"${s.name}${desc}"`;
      })
      .join(" ");
    lines.push(`    local -a _subs=(${subItems})`);
    lines.push(`    __${fn}_cdescribe 'subcommands' _subs`);
  } else if (sub.positionals.length > 0) {
    lines.push(...positionalBlock(sub.positionals, fn));
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
  for (const child of sub.subcommands) {
    if (!child.name.startsWith("__")) {
      lines.push(...optTakesValueEntries(child, child.name));
    }
  }
  return lines;
}

export function generateZshCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  const data = extractCompletionData(command, options.programName);
  const fn = sanitize(options.programName);
  const root = data.command;
  const visibleSubs = root.subcommands.filter((s) => !s.name.startsWith("__"));

  const lines: string[] = [];
  lines.push(`#compdef ${options.programName}`);
  lines.push(``);
  lines.push(`# Zsh completion for ${options.programName}`);
  lines.push(`# Generated by politty`);
  lines.push(``);

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

  // Per-subcommand completion functions
  for (const sub of visibleSubs) {
    lines.push(...generateSubHandler(sub, fn, []));
  }

  // Root handler
  // NOTE: Inline --opt=value completion is not yet supported in zsh; only
  // separate-word value completion (--opt <value>) is handled. Bash supports
  // inline via _inline_prefix parsing.
  const rootValueOpts = root.options.filter((o) => o.takesValue && o.valueCompletion);
  lines.push(`__${fn}_complete_root() {`);
  lines.push(`    local -a _vals=()`);
  if (rootValueOpts.length > 0) {
    const prevCases = optionValueCases(root.options, fn);
    if (prevCases.length > 0) {
      lines.push(`    case "\${words[CURRENT-1]}" in`);
      lines.push(...prevCases);
      lines.push(`    esac`);
    }
  }
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(`    if __${fn}_opt_takes_value "" "\${words[CURRENT-1]}"; then return 0; fi`);
  if (root.positionals.length > 0) {
    lines.push(`    if (( _after_dd )); then`);
    lines.push(...positionalBlock(root.positionals, fn).map((l) => `    ${l}`));
    lines.push(`        return 0`);
    lines.push(`    fi`);
  } else {
    lines.push(`    if (( _after_dd )); then return 0; fi`);
  }
  lines.push(`    if [[ "\${words[CURRENT]}" == -* ]]; then`);
  lines.push(`        local -a _opts=()`);
  for (const opt of root.options) {
    const desc = opt.description ? `:${escapeDesc(opt.description)}` : "";
    if (opt.valueType === "array") {
      lines.push(`        _opts+=("--${opt.cliName}${desc}")`);
    } else {
      const patterns: string[] = [`"--${opt.cliName}"`];
      if (opt.alias) patterns.push(`"-${opt.alias}"`);
      lines.push(
        `        __${fn}_not_used ${patterns.join(" ")} && _opts+=("--${opt.cliName}${desc}")`,
      );
    }
  }
  lines.push(`        __${fn}_not_used "--help" && _opts+=("--help:Show help")`);
  lines.push(`        __${fn}_cdescribe 'options' _opts`);
  if (visibleSubs.length > 0) {
    lines.push(`    else`);
    const subItems = visibleSubs
      .map((s) => {
        const desc = s.description ? `:${escapeDesc(s.description)}` : "";
        return `"${s.name}${desc}"`;
      })
      .join(" ");
    lines.push(`        local -a _subs=(${subItems})`);
    lines.push(`        __${fn}_cdescribe 'subcommands' _subs`);
  } else if (root.positionals.length > 0) {
    lines.push(`    else`);
    lines.push(...positionalBlock(root.positionals, fn).map((l) => `    ${l}`));
  }
  lines.push(`    fi`);
  lines.push(`}`);
  lines.push(``);

  // Main completion function
  const subRouting = visibleSubs
    .map((s) => `        ${s.name}) __${fn}_complete_${sanitize(s.name)} ;;`)
    .join("\n");

  lines.push(`_${fn}() {`);
  lines.push(`    (( CURRENT )) || CURRENT=\${#words}`);
  lines.push(``);
  lines.push(`    local _subcmd="" _after_dd=0 _pos_count=0 _skip_next=0`);
  lines.push(`    local -a _used_opts=()`);
  lines.push(``);
  lines.push(`    local _j=2`);
  lines.push(`    while (( _j < CURRENT )); do`);
  lines.push(`        local _w="\${words[_j]}"`);
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
  lines.push(
    `zstyle ':completion:*:*:${options.programName}:*' file-patterns '%p:globbed-files *(-/):directories'`,
  );
  lines.push(``);
  lines.push(`compdef _${fn} ${options.programName}`);
  lines.push(``);

  const { programName } = options;

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
