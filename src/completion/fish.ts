/**
 * Fish completion script generator (static)
 *
 * Generates a self-contained fish completion script that embeds all
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

/** Escape shell-special characters for fish double-quoted strings */
function escapeDesc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

/**
 * Generate fish value completion lines for a ValueCompletion spec.
 * Each line outputs candidates via echo (tab-separated value\tdescription).
 */
function fishValueLines(vc: ValueCompletion | undefined): string[] {
  if (!vc) return [];
  switch (vc.type) {
    case "choices":
      return vc.choices!.map((c) => `echo "${c}"`);
    case "file": {
      if (vc.extensions?.length) {
        return fishExtensionLines(vc.extensions);
      }
      return [`__fish_complete_path "$_cur"`];
    }
    case "directory":
      return [`__fish_complete_directories "$_cur"`];
    case "command":
      return [`for _v in (${vc.shellCommand!})`, `    echo "$_v"`, `end`];
    case "none":
      return [];
  }
}

/** Generate fish extension-filtered file completion */
function fishExtensionLines(extensions: string[]): string[] {
  const lines: string[] = [];
  lines.push(`__fish_complete_directories "$_cur"`);
  for (const ext of extensions) {
    lines.push(`for _f in "$_cur"*.${ext}`);
    lines.push(`    test -f "$_f"; and echo "$_f"`);
    lines.push(`end`);
  }
  return lines;
}

/** Generate option-value switch cases for fish */
function optionValueCases(options: CompletableOption[]): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = fishValueLines(opt.valueCompletion);
    if (valLines.length === 0) continue;

    const conditions: string[] = [`test "$_prev" = "--${opt.cliName}"`];
    if (opt.alias) {
      conditions.push(`test "$_prev" = "-${opt.alias}"`);
    }
    const cond = conditions.join("; or ");

    lines.push(`    if ${cond}`);
    for (const vl of valLines) {
      lines.push(`        ${vl}`);
    }
    lines.push(`        return`);
    lines.push(`    end`);
  }
  return lines;
}

/** Generate positional completion block for fish */
function positionalBlock(positionals: CompletablePositional[]): string[] {
  if (positionals.length === 0) return [];
  const lines: string[] = [];
  for (const pos of positionals) {
    const valLines = fishValueLines(pos.valueCompletion);
    if (valLines.length === 0) continue;

    if (pos.variadic) {
      lines.push(`    if test $_pos_count -ge ${pos.position}`);
    } else {
      lines.push(`    if test $_pos_count -eq ${pos.position}`);
    }
    for (const vl of valLines) {
      lines.push(`        ${vl}`);
    }
    lines.push(`        return`);
    lines.push(`    end`);
  }
  return lines;
}

/**
 * Generate a per-subcommand completion function for fish.
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

  lines.push(`function ${funcName} --no-scope-shadowing`);

  // 1. Option value completion
  if (valueTakingOpts.length > 0) {
    lines.push(...optionValueCases(sub.options));
  }
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(`    if __${fn}_opt_takes_value "${sub.name}" "$_prev"; return; end`);

  // 2. After -- separator
  if (sub.positionals.length > 0) {
    lines.push(`    if test $_after_dd -eq 1`);
    lines.push(...positionalBlock(sub.positionals).map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    end`);
  } else {
    lines.push(`    if test $_after_dd -eq 1; return; end`);
  }

  // 3. Option name completion
  lines.push(`    if string match -q -- '-*' "$_cur"`);
  for (const opt of sub.options) {
    const checks: string[] = [`"--${opt.cliName}"`];
    if (opt.alias) checks.push(`"-${opt.alias}"`);
    const desc = escapeDesc(opt.description ?? "");
    lines.push(
      `        __${fn}_not_used ${checks.join(" ")}; and echo "--${opt.cliName}\t${desc}"`,
    );
  }
  lines.push(`        __${fn}_not_used "--help"; and echo "--help\tShow help"`);
  lines.push(`        return`);
  lines.push(`    end`);

  // 4. Subcommand or positional completion
  if (visibleSubs.length > 0) {
    for (const s of visibleSubs) {
      const desc = escapeDesc(s.description ?? "");
      lines.push(`    echo "${s.name}\t${desc}"`);
    }
  } else if (sub.positionals.length > 0) {
    lines.push(...positionalBlock(sub.positionals));
  }

  lines.push(`end`);
  lines.push(``);
  return lines;
}

/** Generate opt-takes-value entries for fish switch cases */
function optTakesValueCases(sub: CompletableSubcommand, subcmdName: string): string[] {
  const lines: string[] = [];
  for (const opt of sub.options) {
    if (opt.takesValue) {
      const patterns: string[] = [`"${subcmdName}:--${opt.cliName}"`];
      if (opt.alias) patterns.push(`"${subcmdName}:-${opt.alias}"`);
      lines.push(`        case ${patterns.join(" ")}`);
      lines.push(`            return 0`);
    }
  }
  for (const child of sub.subcommands) {
    if (!child.name.startsWith("__")) {
      lines.push(...optTakesValueCases(child, child.name));
    }
  }
  return lines;
}

export function generateFishCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  const data = extractCompletionData(command, options.programName);
  const fn = sanitize(options.programName);
  const root = data.command;
  const visibleSubs = root.subcommands.filter((s) => !s.name.startsWith("__"));

  const lines: string[] = [];
  lines.push(`# Fish completion for ${options.programName}`);
  lines.push(`# Generated by politty`);
  lines.push(``);

  // Helper: check if option is already used
  lines.push(`function __${fn}_not_used --no-scope-shadowing`);
  lines.push(`    for _chk in $argv`);
  lines.push(`        if contains -- "$_chk" $_used_opts`);
  lines.push(`            return 1`);
  lines.push(`        end`);
  lines.push(`    end`);
  lines.push(`    return 0`);
  lines.push(`end`);
  lines.push(``);

  // Helper: check if option takes a value
  lines.push(`function __${fn}_opt_takes_value`);
  lines.push(`    switch "$argv[1]:$argv[2]"`);
  lines.push(...optTakesValueCases(root, ""));
  lines.push(`    end`);
  lines.push(`    return 1`);
  lines.push(`end`);
  lines.push(``);

  // Per-subcommand completion functions
  for (const sub of visibleSubs) {
    lines.push(...generateSubHandler(sub, fn, []));
  }

  // Root handler
  // NOTE: Inline --opt=value completion is not yet supported in fish; only
  // separate-word value completion (--opt <value>) is handled. Bash supports
  // inline via _inline_prefix parsing.
  const rootValueOpts = root.options.filter((o) => o.takesValue && o.valueCompletion);
  lines.push(`function __${fn}_complete_root --no-scope-shadowing`);
  if (rootValueOpts.length > 0) {
    lines.push(...optionValueCases(root.options));
  }
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(`    if __${fn}_opt_takes_value "" "$_prev"; return; end`);
  if (root.positionals.length > 0) {
    lines.push(`    if test $_after_dd -eq 1`);
    lines.push(...positionalBlock(root.positionals).map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    end`);
  } else {
    lines.push(`    if test $_after_dd -eq 1; return; end`);
  }
  lines.push(`    if string match -q -- '-*' "$_cur"`);
  for (const opt of root.options) {
    const checks: string[] = [`"--${opt.cliName}"`];
    if (opt.alias) checks.push(`"-${opt.alias}"`);
    const desc = escapeDesc(opt.description ?? "");
    lines.push(
      `        __${fn}_not_used ${checks.join(" ")}; and echo "--${opt.cliName}\t${desc}"`,
    );
  }
  lines.push(`        __${fn}_not_used "--help"; and echo "--help\tShow help"`);
  if (visibleSubs.length > 0) {
    lines.push(`    else`);
    for (const s of visibleSubs) {
      const desc = escapeDesc(s.description ?? "");
      lines.push(`        echo "${s.name}\t${desc}"`);
    }
  } else if (root.positionals.length > 0) {
    lines.push(`    else`);
    lines.push(...positionalBlock(root.positionals));
  }
  lines.push(`    end`);
  lines.push(`end`);
  lines.push(``);

  // Main completion function
  lines.push(`function __fish_${fn}_complete`);
  lines.push(`    set -l _args (commandline -opc)`);
  lines.push(`    set -e _args[1]`);
  lines.push(``);
  lines.push(`    set -l _ct (commandline -ct)`);
  lines.push(`    if test (count $_ct) -eq 0`);
  lines.push(`        set -a _args ""`);
  lines.push(`    else`);
  lines.push(`        set -a _args $_ct`);
  lines.push(`    end`);
  lines.push(``);
  lines.push(`    set -l _cur ""`);
  lines.push(`    if test (count $_args) -gt 0`);
  lines.push(`        set _cur "$_args[-1]"`);
  lines.push(`    end`);
  lines.push(``);
  lines.push(`    set -l _prev ""`);
  lines.push(`    if test (count $_args) -gt 1`);
  lines.push(`        set _prev "$_args[-2]"`);
  lines.push(`    end`);
  lines.push(``);
  lines.push(
    `    set -l _subcmd "" ; set -l _after_dd 0 ; set -l _pos_count 0 ; set -l _skip_next 0`,
  );
  lines.push(`    set -l _used_opts`);
  lines.push(``);
  lines.push(`    set -l _j 1`);
  lines.push(`    set -l _limit (math (count $_args) - 1)`);
  lines.push(`    while test $_j -le $_limit`);
  lines.push(`        set -l _w "$_args[$_j]"`);
  lines.push(
    `        if test $_skip_next -eq 1; set _skip_next 0; set _j (math $_j + 1); continue; end`,
  );
  lines.push(`        if test "$_w" = "--"; set _after_dd 1; set _j (math $_j + 1); continue; end`);
  lines.push(
    `        if test $_after_dd -eq 1; set _pos_count (math $_pos_count + 1); set _j (math $_j + 1); continue; end`,
  );
  lines.push(
    `        if string match -q -- '--*=*' "$_w"; set -a _used_opts (string replace -r '=.*' '' -- "$_w"); set _j (math $_j + 1); continue; end`,
  );
  lines.push(`        if string match -q -- '-*' "$_w"`);
  lines.push(`            set -a _used_opts "$_w"`);
  lines.push(`            __${fn}_opt_takes_value "$_subcmd" "$_w"; and set _skip_next 1`);
  lines.push(`            set _j (math $_j + 1); continue`);
  lines.push(`        end`);
  // NOTE: Only first-level subcommand dispatch is supported. Nested subcommand
  // handlers are generated but not yet dispatched (requires multi-level word parsing).
  if (visibleSubs.length > 0) {
    lines.push(
      `        if test -z "$_subcmd"; set _subcmd "$_w"; else; set _pos_count (math $_pos_count + 1); end`,
    );
  } else {
    lines.push(`        set _pos_count (math $_pos_count + 1)`);
  }
  lines.push(`        set _j (math $_j + 1)`);
  lines.push(`    end`);
  lines.push(``);

  // Route to subcommand handler
  lines.push(`    switch "$_subcmd"`);
  for (const s of visibleSubs) {
    lines.push(`        case "${s.name}"; __${fn}_complete_${sanitize(s.name)}`);
  }
  lines.push(`        case '*'; __${fn}_complete_root`);
  lines.push(`    end`);
  lines.push(`end`);
  lines.push(``);

  // Register completion
  lines.push(`# Clear existing completions`);
  lines.push(`complete -e -c ${options.programName}`);
  lines.push(``);
  lines.push(`# Register completion`);
  lines.push(`complete -c ${options.programName} -f -a '(__fish_${fn}_complete)'`);
  lines.push(``);

  const { programName } = options;

  return {
    script: lines.join("\n"),
    shell: "fish",
    installInstructions: `# To enable completions, run one of the following:

# Option 1: Source directly
${programName} completion fish | source

# Option 2: Save to the fish completions directory
${programName} completion fish > ~/.config/fish/completions/${programName}.fish

# The completion will be available immediately in new shell sessions.
# To use in the current session, run:
source ~/.config/fish/completions/${programName}.fish`,
  };
}
