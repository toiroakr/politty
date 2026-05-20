/**
 * Fish completion script generator (static)
 *
 * Generates a self-contained fish completion script that embeds all
 * completion metadata. No Node.js process is spawned on TAB.
 */

import type { AnyCommand } from "../types.js";
import { CompletionDirective } from "./dynamic/candidate-generator.js";
import {
  binEnvVarName,
  collectExpandSpecs,
  collectRouteEntries,
  collectTrackedFields,
  effectiveOptionTokens,
  extractCompletionData,
  getSubNamesWithAliases,
  getVisibleSubs,
  hasDynamicCompletion,
  sanitize,
} from "./extractor.js";
import {
  globalNamesIn,
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

/** Escape shell-special characters for fish double-quoted strings */
function escapeDesc(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$/g, "\\$");
}

/**
 * Escape a fish `switch` case pattern. Fish's `case` interprets its
 * arguments as globs even when double-quoted, so glob metacharacters
 * (`*`, `?`, `[`, `]`) must be backslash-escaped to keep the comparison
 * literal — otherwise a key like `prod*` would also match a runtime
 * value of `production`. Quote/dollar/backslash are escaped first so the
 * resulting string remains valid inside a double-quoted literal.
 */
function fishCaseEscape(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/\*/g, "\\*")
    .replace(/\?/g, "\\?")
    .replace(/\[/g, "\\[")
    .replace(/]/g, "\\]");
}

interface FishExpandLocation {
  fieldName: string;
  /**
   * Enable runtime deduplication of already-consumed `key=` candidates
   * for repeatable array options. Always false for scalar options and
   * positionals.
   */
  isArrayOption: boolean;
  /**
   * True when the host option is global. Globals keep their dedup bucket
   * in `_global_used_field_keys_<bucket>` (which is not cleared on
   * subcommand descent) so already-consumed `key=value` slots remain
   * hidden from descendant frames.
   */
  isGlobal: boolean;
  /**
   * Resolved sibling deps in `dependsOn` order. Each entry pairs the dep
   * name with its globality so the lookup reads from the correct bucket:
   * local deps from `_arg_values_<name>` only, global deps from
   * `_global_arg_values_<name>` only.
   */
  resolvedDeps: readonly ResolvedExpandDep[];
}

/**
 * Generate fish value completion lines for a ValueCompletion spec.
 * Each line outputs candidates via echo (tab-separated value\tdescription).
 *
 * `location` is required for the expand variant (carries fieldName +
 * isArrayOption); other variants ignore it.
 */
function fishValueLines(
  vc: ValueCompletion | undefined,
  fn: string,
  location?: FishExpandLocation,
): string[] {
  if (!vc) return [];
  switch (vc.type) {
    case "expand": {
      if (!location) {
        throw new Error("fishValueLines: expand variant requires a location");
      }
      // Fish has no associative arrays, so emit an inline switch over the
      // dependsOn values. For multi-dimensional dependsOn the values are
      // concatenated with the unit-separator so they collide cleanly with
      // the table keys we encode here. Candidates carry `value\tdescription`
      // when a description is set, matching fish's preferred format. Each
      // dep reads from its matching bucket — local deps from
      // `_arg_values_<d>`, global deps from `_global_arg_values_<d>` —
      // so a local dep is never accidentally satisfied by a same-named
      // global value supplied at a parent frame.
      // Fish variable names accept only alnum + underscore; sanitize the
      // field name so a hyphenated schema key (e.g. `env-name`) still
      // produces a valid `$_arg_values_env_name`.
      const depExpr = (d: ResolvedExpandDep): string => {
        const safe = sanitize(d.name);
        return d.isGlobal ? `$_global_arg_values_${safe}` : `$_arg_values_${safe}`;
      };
      const depKey = location.resolvedDeps.map((d) => `"${depExpr(d)}"`).join(`\\x1f`);
      const bucket = sanitize(location.fieldName);
      // Array dedup bucket lookup mirrors host scope: globals read the
      // _global bucket; locals read the local bucket.
      const bucketList = location.isGlobal
        ? `$_global_used_field_keys_${bucket}`
        : `$_used_field_keys_${bucket}`;
      const out: string[] = [`switch ${depKey}`];
      for (const entry of vc.table) {
        // Mirror `depKey`'s layout: each segment is its own double-quoted
        // string with an UNQUOTED `\x1f` joining them. Fish does not honor
        // `\x` escapes inside double quotes, so `case "k1\x1fk2"` would
        // wait for a literal `\x1f` sequence and never match the switch
        // expression (which carries the actual 0x1f byte).
        const casePattern = entry.key.map((k) => `"${fishCaseEscape(k)}"`).join(`\\x1f`);
        out.push(`    case ${casePattern}`);

        // Two-stage `key=value`: when the user has not typed `=` yet,
        // emit each unique key as `key=` so the first TAB picks the
        // key. After `=` is typed the full `key=value` candidates are
        // emitted so the second TAB picks the value. The branch is
        // selected at runtime via `$_cur` so the user sees only what
        // is relevant for their current input.
        const keyOnlyLines: string[] = [];
        const fullLines: string[] = [];
        const seenKeys = new Set<string>();

        // `printf` instead of `echo` — `expand` candidates accept arbitrary
        // strings, and a value matching one of fish's `echo` flags (`-n`,
        // `-e`, `-s`, `-E`) would be swallowed as an option and disappear
        // from the completion list.
        const printfLine = (value: string, description?: string): string =>
          description
            ? `printf '%s\\t%s\\n' "${escapeDesc(value)}" "${escapeDesc(description)}"`
            : `printf '%s\\n' "${escapeDesc(value)}"`;
        // Wrap a single echo line in the array-host dedup guard when the
        // host is repeatable AND the candidate carries a key prefix. For
        // candidates without `=` the dedup is a no-op so the line is
        // emitted bare.
        const wrapWithDedup = (echoLine: string, keyPart: string): string[] =>
          location.isArrayOption && keyPart.length > 0
            ? [
                `        if not contains -- "${escapeDesc(keyPart)}" ${bucketList}`,
                `            ${echoLine}`,
                `        end`,
              ]
            : [`        ${echoLine}`];

        for (const c of entry.candidates) {
          const eqIdx = c.value.indexOf("=");
          const keyPart = eqIdx > 0 ? c.value.slice(0, eqIdx) : "";
          const echoLine = printfLine(c.value, c.description);

          fullLines.push(...wrapWithDedup(echoLine, keyPart));

          if (keyPart.length === 0) {
            // Candidate without `=` — same in both branches.
            keyOnlyLines.push(`        ${echoLine}`);
          } else if (!seenKeys.has(keyPart)) {
            seenKeys.add(keyPart);
            // Reuse the original description on the collapsed key form.
            keyOnlyLines.push(...wrapWithDedup(printfLine(`${keyPart}=`, c.description), keyPart));
          }
        }

        if (keyOnlyLines.length > 0 && fullLines.length > keyOnlyLines.length) {
          out.push(`        if string match -q '*=*' -- "$_cur"`);
          out.push(...fullLines);
          out.push(`        else`);
          out.push(...keyOnlyLines);
          out.push(`        end`);
        } else {
          out.push(...fullLines);
        }
      }
      out.push(`end`);
      return out;
    }
    case "dynamic": {
      // Delegate to `<program> __complete --shell fish` and pipe each line
      // through the apply helper, which interprets the trailing
      // `:<directive>` so resolver-supplied file/directory completion still
      // reaches the shell. `$_cur` is passed so file/dir directives respect
      // the partial path the user has typed.
      return [`__${fn}_invoke_complete fish $_args | __${fn}_apply_dynamic_output "$_cur"`];
    }
    case "choices":
      return vc.choices!.map((c) => `echo "${escapeDesc(c)}"`);
    case "file": {
      if (vc.matcher?.length) {
        return fishMatcherLines(vc.matcher);
      }
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

/** Generate fish matcher-filtered file completion */
function fishMatcherLines(patterns: string[]): string[] {
  return [
    `__fish_complete_directories "$_cur"`,
    // Extract directory prefix from $_cur for correct subdirectory matching
    `set -l _dir ""`,
    `if string match -q '*/*' "$_cur"`,
    `    set _dir (string replace -r '[^/]*$' '' "$_cur")`,
    `end`,
    ...patterns.flatMap((p) => [
      `for _f in "$_dir"${p}`,
      `    test -f "$_f"; and string match -q "$_cur*" "$_f"; and echo "$_f"`,
      `end`,
    ]),
  ];
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
function optionValueCases(options: CompletableOption[], fn: string): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = fishValueLines(opt.valueCompletion, fn, {
      fieldName: opt.name,
      isArrayOption: opt.valueType === "array",
      isGlobal: opt.isGlobal === true,
      resolvedDeps: resolveExpandDepGlobality(
        opt.valueCompletion,
        opt.isGlobal === true,
        globalNamesIn(options),
      ),
    });
    if (valLines.length === 0) continue;

    // Mirror the bash/zsh tracker emission: use every CLI token the
    // runtime's aliasMap accepts so a value-completion trigger fires
    // for every valid spelling of this option (1-char cliName as `-x`,
    // 1-char alias long form `--f`, camelCase of hyphenated names).
    const conditions = effectiveOptionTokens(opt, options).map((t) => `test "$_prev" = "${t}"`);
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
function positionalBlock(
  positionals: CompletablePositional[],
  fn: string,
  options: readonly CompletableOption[] = [],
): string[] {
  if (positionals.length === 0) return [];
  const lines: string[] = [];
  for (const pos of positionals) {
    const valLines = fishValueLines(pos.valueCompletion, fn, {
      fieldName: pos.name,
      isArrayOption: false,
      isGlobal: false,
      resolvedDeps: pos.valueCompletion
        ? resolveExpandDepGlobality(pos.valueCompletion, false, globalNamesIn(options))
        : [],
    });
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

/** Generate available-option echo lines for fish */
function availableOptionLines(options: CompletableOption[], fn: string): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    const desc = escapeDesc(opt.description ?? "");
    if (opt.valueType === "array") {
      lines.push(`        echo "--${opt.cliName}\t${desc}"`);
      continue;
    }
    const checks = quotedAvailabilityTokens(opt.cliName, opt.alias, opt.negation, {
      isGlobal: opt.isGlobal === true,
      frameOptions: options,
    });
    const guard = `__${fn}_not_used ${checks.join(" ")}`;
    const negDesc = opt.negationDescription ? escapeDesc(opt.negationDescription) : desc;
    const entries: Array<{ name: string; desc: string }> = [{ name: opt.cliName, desc }];
    if (opt.negation) entries.push({ name: opt.negation, desc: negDesc });
    for (const e of entries) {
      lines.push(`        ${guard}; and echo "--${e.name}\t${e.desc}"`);
    }
  }
  lines.push(`        __${fn}_not_used "--help"; and echo "--help\tShow help"`);
  return lines;
}

/**
 * Generate a per-subcommand completion function for fish.
 * Recursively generates functions for nested subcommands.
 */
function generateSubHandler(sub: CompletableSubcommand, fn: string, path: string[]): string[] {
  const fullPath = [...path, sub.name];
  const funcName = `__${fn}_complete_${fullPath.map(sanitize).join("_")}`;
  const visibleSubs = getVisibleSubs(sub.subcommands);

  const lines: string[] = [];

  // Recursively generate handlers for child subcommands
  for (const child of visibleSubs) {
    lines.push(...generateSubHandler(child, fn, fullPath));
  }

  lines.push(`function ${funcName} --no-scope-shadowing`);

  // 1. Option value completion
  lines.push(...optionValueCases(sub.options, fn));
  // Fallback: value-taking option without explicit completion → default file completion
  const fullPathStr = fullPath.join(":");
  lines.push(`    if __${fn}_opt_takes_value "${fullPathStr}" "$_prev"; return; end`);

  // 2. After -- separator
  if (sub.positionals.length > 0) {
    lines.push(`    if test $_after_dd -eq 1`);
    lines.push(...positionalBlock(sub.positionals, fn, sub.options).map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    end`);
  } else {
    lines.push(`    if test $_after_dd -eq 1; return; end`);
  }

  // 3. Option name completion
  lines.push(`    if string match -q -- '-*' "$_cur"`);
  lines.push(...availableOptionLines(sub.options, fn));
  lines.push(`        return`);
  lines.push(`    end`);

  // 4. Subcommand or positional completion (includes aliases)
  if (visibleSubs.length > 0) {
    for (const s of getSubNamesWithAliases(sub.subcommands)) {
      const desc = escapeDesc(s.description ?? "");
      lines.push(`    echo "${s.name}\t${desc}"`);
    }
  } else if (sub.positionals.length > 0) {
    lines.push(...positionalBlock(sub.positionals, fn, sub.options));
  }

  lines.push(`end`);
  lines.push(``);
  return lines;
}

/** Generate opt-takes-value entries for fish switch cases */
function optTakesValueCases(sub: CompletableSubcommand, parentPath: string): string[] {
  const lines: string[] = [];
  for (const opt of sub.options) {
    if (opt.takesValue) {
      // Use the same full token set as bash/zsh — runtime's aliasMap
      // accepts every spelling these tokens cover, so the takes-value
      // switch must enumerate them all.
      const patterns = effectiveOptionTokens(opt, sub.options).map((t) => `"${parentPath}:${t}"`);
      lines.push(`        case ${patterns.join(" ")}`);
      lines.push(`            return 0`);
    }
  }
  for (const child of getVisibleSubs(sub.subcommands)) {
    const childPath = parentPath ? `${parentPath}:${child.name}` : child.name;
    lines.push(...optTakesValueCases(child, childPath));
    // Also generate opt-takes-value cases under alias paths
    if (child.aliases) {
      for (const alias of child.aliases) {
        const aliasPath = parentPath ? `${parentPath}:${alias}` : alias;
        lines.push(...optTakesValueCases(child, aliasPath));
      }
    }
  }
  return lines;
}

export function generateFishCompletion(
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
  const hasExpand = expandSpecs.length > 0;
  const arrayExpandSpecs = expandSpecs.filter((s) => s.isArrayOption);
  const hasArrayExpand = arrayExpandSpecs.length > 0;

  const lines: string[] = [];
  lines.push(`# Fish completion for ${programName}`);
  lines.push(`# Generated by politty`);
  lines.push(``);

  // Dynamic completion delegate helpers (only when any value spec uses
  // an in-process JS resolver).
  if (hasDynamicCompletion(root)) {
    lines.push(`function __${fn}_invoke_complete`);
    lines.push(`    set -l _shell $argv[1]`);
    lines.push(`    set -l _argv $argv[2..]`);
    lines.push(`    set -l _bin ${programName}`);
    lines.push(`    if set -q ${binEnvVarName(fn)}`);
    lines.push(`        set _bin $${binEnvVarName(fn)}`);
    lines.push(`    end`);
    lines.push(`    $_bin __complete --shell $_shell -- $_argv 2>/dev/null`);
    lines.push(`end`);
    lines.push(``);
    lines.push(`function __${fn}_apply_dynamic_output`);
    lines.push(`    set -l _cur $argv[1]`);
    lines.push(`    set -l _directive 0`);
    // Buffer one line so we can detect the trailing `:<digits>` directive
    // sentinel without misinterpreting candidate values that legitimately
    // start with `:` in intermediate positions.
    lines.push(`    set -l _prev ""`);
    lines.push(`    set -l _has_prev 0`);
    // Skip only blanks. The `@ext:`/`@matcher:` sentinels are produced by
    // the static shellCommand pipeline, not by dynamic resolvers — filtering
    // them here would silently drop resolver candidates that happen to
    // start with those literal strings.
    lines.push(`    while read -l _l`);
    lines.push(`        if test $_has_prev -eq 1`);
    lines.push(`            if test -n "$_prev"`);
    // `printf` rather than `echo` — a resolver candidate that happens to
    // match a fish `echo` flag (`-n`, `-e`, `-s`, `-E`) would otherwise
    // be swallowed as an option instead of being emitted as a candidate.
    lines.push(`                printf '%s\\n' "$_prev"`);
    lines.push(`            end`);
    lines.push(`        end`);
    lines.push(`        set _prev $_l`);
    lines.push(`        set _has_prev 1`);
    lines.push(`    end`);
    lines.push(`    if test $_has_prev -eq 1`);
    lines.push(`        if string match -qr '^:[0-9]+$' -- $_prev`);
    lines.push(`            set _directive (string sub -s 2 -- $_prev)`);
    lines.push(`        else`);
    lines.push(`            if test -n "$_prev"`);
    lines.push(`                printf '%s\\n' "$_prev"`);
    lines.push(`            end`);
    lines.push(`        end`);
    lines.push(`    end`);
    // Apply resolver-supplied directive bits. fish lacks compopt; emit
    // path/dir candidates inline (filtered by the partially-typed token)
    // so completion still includes them. fish's `math` does not accept
    // the `&` operator (it errors with "Logical operations are not
    // supported"), so use the `bitand()` function form instead.
    lines.push(
      `    if test (math "bitand($_directive, ${CompletionDirective.DirectoryCompletion})") -ne 0`,
    );
    lines.push(`        __fish_complete_directories "$_cur"`);
    lines.push(
      `    else if test (math "bitand($_directive, ${CompletionDirective.FileCompletion})") -ne 0`,
    );
    lines.push(`        __fish_complete_path "$_cur"`);
    lines.push(`    end`);
    lines.push(`end`);
    lines.push(``);
  }

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

  if (hasExpand) {
    // Trackers populate `_arg_values_<field>` global scalars during the
    // main scan loop. Each expand spec looks up the value via the same
    // variable to pick a case branch. `sanitize` keeps the variable
    // names valid (alnum + underscore) even for hyphenated schema keys.
    lines.push(`function __${fn}_track_opt --no-scope-shadowing`);
    lines.push(`    switch "$argv[1]:$argv[2]"`);
    for (const t of trackedFields) {
      if (t.isPositional || !t.optionTokens) continue;
      const cases = t.pathStrs.flatMap((p) => t.optionTokens!.map((n) => `"${p}:${n}"`)).join(" ");
      const prefix = t.isGlobal ? `_global_arg_values_` : `_arg_values_`;
      lines.push(`        case ${cases}`);
      lines.push(`            set -g ${prefix}${sanitize(t.fieldName)} "$argv[3]"`);
    }
    lines.push(`    end`);
    lines.push(`end`);
    lines.push(``);
    lines.push(`function __${fn}_track_pos --no-scope-shadowing`);
    lines.push(`    switch "$argv[1]:$argv[2]"`);
    for (const t of trackedFields) {
      if (!t.isPositional) continue;
      const cases = t.pathStrs.map((p) => `"${p}:${t.position}"`).join(" ");
      const prefix = t.isGlobal ? `_global_arg_values_` : `_arg_values_`;
      lines.push(`        case ${cases}`);
      lines.push(`            set -g ${prefix}${sanitize(t.fieldName)} "$argv[3]"`);
    }
    lines.push(`    end`);
    lines.push(`end`);
    lines.push(``);
  }

  if (hasArrayExpand) {
    // Track which `key=` slots a repeatable array option has already
    // consumed. Stored in a per-field global list (one variable per
    // expand-host fieldName) so multiple coexisting array expand options
    // don't share a bucket. Kept separate from `__track_opt` to avoid
    // case-pattern collisions if an option is both a dependsOn target
    // and an array expand host.
    lines.push(`function __${fn}_track_array_expand --no-scope-shadowing`);
    lines.push(`    switch "$argv[1]:$argv[2]"`);
    for (const spec of arrayExpandSpecs) {
      const cases = spec.pathStrs
        .flatMap((p) => spec.optionTokens.map((tok) => `"${p}:${tok}"`))
        .join(" ");
      const bucket = sanitize(spec.fieldName);
      const bucketVar = spec.isGlobal ? `_global_used_field_keys_` : `_used_field_keys_`;
      lines.push(`        case ${cases}`);
      lines.push(`            if string match -q '*=*' -- "$argv[3]"`);
      lines.push(`                set -l _k (string replace -r '=.*' '' -- "$argv[3]")`);
      lines.push(`                if test -n "$_k"`);
      if (spec.isGlobal) {
        // Mirror runtime per-frame replace semantics for global arrays.
        lines.push(`                    if not set -q _global_arr_seen_${bucket}`);
        lines.push(`                        set -g ${bucketVar}${bucket} "$_k"`);
        lines.push(`                        set -g _global_arr_seen_${bucket} 1`);
        lines.push(`                    else if not contains -- "$_k" $${bucketVar}${bucket}`);
        lines.push(`                        set -ga ${bucketVar}${bucket} "$_k"`);
        lines.push(`                    end`);
      } else {
        lines.push(`                    if not contains -- "$_k" $${bucketVar}${bucket}`);
        lines.push(`                        set -ga ${bucketVar}${bucket} "$_k"`);
        lines.push(`                    end`);
      }
      lines.push(`                end`);
      lines.push(`            end`);
    }
    lines.push(`    end`);
    lines.push(`end`);
    lines.push(``);
  }

  // Collect all nested subcommand routes (used for both is_subcmd and dispatch)
  const routeEntries = collectRouteEntries(root);

  // Helper: check if a word is a known subcommand at the current path level
  if (routeEntries.length > 0) {
    lines.push(`function __${fn}_is_subcmd`);
    lines.push(`    switch "$argv[1]:$argv[2]"`);
    for (const r of routeEntries) {
      lines.push(`        case "${r.lookupPattern}"`);
      lines.push(`            return 0`);
    }
    lines.push(`    end`);
    lines.push(`    return 1`);
    lines.push(`end`);
    lines.push(``);
  }

  // Per-subcommand completion functions
  for (const sub of visibleSubs) {
    lines.push(...generateSubHandler(sub, fn, []));
  }

  // Root handler
  // NOTE: Inline --opt=value completion is not yet supported in fish; only
  // separate-word value completion (--opt <value>) is handled. Bash supports
  // inline via _inline_prefix parsing.
  lines.push(`function __${fn}_complete_root --no-scope-shadowing`);
  lines.push(...optionValueCases(root.options, fn));
  // Fallback: value-taking option without explicit completion → default file completion
  lines.push(`    if __${fn}_opt_takes_value "" "$_prev"; return; end`);
  if (root.positionals.length > 0) {
    lines.push(`    if test $_after_dd -eq 1`);
    lines.push(...positionalBlock(root.positionals, fn, root.options).map((l) => `    ${l}`));
    lines.push(`        return`);
    lines.push(`    end`);
  } else {
    lines.push(`    if test $_after_dd -eq 1; return; end`);
  }
  lines.push(`    if string match -q -- '-*' "$_cur"`);
  lines.push(...availableOptionLines(root.options, fn));
  if (visibleSubs.length > 0) {
    lines.push(`    else`);
    for (const s of getSubNamesWithAliases(root.subcommands)) {
      const desc = escapeDesc(s.description ?? "");
      lines.push(`        echo "${s.name}\t${desc}"`);
    }
  } else if (root.positionals.length > 0) {
    lines.push(`    else`);
    lines.push(...positionalBlock(root.positionals, fn, root.options));
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
  if (hasExpand) {
    // Clear any sibling values left over from previous completions so a
    // partial command doesn't pick up stale values from the global scope.
    // Both local and global buckets are cleared because the previous
    // completion run may have populated either side.
    for (const t of trackedFields) {
      lines.push(`    set -e _arg_values_${sanitize(t.fieldName)}`);
      lines.push(`    set -e _global_arg_values_${sanitize(t.fieldName)}`);
    }
  }
  if (hasArrayExpand) {
    for (const spec of arrayExpandSpecs) {
      lines.push(`    set -e _used_field_keys_${sanitize(spec.fieldName)}`);
      lines.push(`    set -e _global_used_field_keys_${sanitize(spec.fieldName)}`);
      // Per-frame seen flag for global array hosts.
      lines.push(`    set -e _global_arr_seen_${sanitize(spec.fieldName)}`);
    }
  }
  lines.push(`    set -l _j 1`);
  lines.push(`    set -l _limit (math (count $_args) - 1)`);
  lines.push(`    while test $_j -le $_limit`);
  lines.push(`        set -l _w "$_args[$_j]"`);
  lines.push(
    `        if test $_skip_next -eq 1; set _skip_next 0; set _j (math $_j + 1); continue; end`,
  );
  lines.push(`        if test "$_w" = "--"; set _after_dd 1; set _j (math $_j + 1); continue; end`);
  // After `--`, all remaining words are positionals. Track them so an
  // expand spec that depends on a positional still sees the value.
  const afterDdTrack = hasExpand ? `__${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"; ` : "";
  lines.push(
    `        if test $_after_dd -eq 1; ${afterDdTrack}set _pos_count (math $_pos_count + 1); set _j (math $_j + 1); continue; end`,
  );
  // Match both `--opt=value` and `-o=value`: the parser accepts the
  // short inline form too, so the scanner must split it before tracking
  // the dep value, otherwise `-e=prod` slips past the tracker.
  lines.push(`        if string match -q -- '-*=*' "$_w"`);
  lines.push(`            set -l _opt (string replace -r '=.*' '' -- "$_w")`);
  lines.push(`            set -a _used_opts "$_opt"`);
  if (hasExpand) {
    lines.push(`            set -l _val (string replace -r '^[^=]*=' '' -- "$_w")`);
    lines.push(`            __${fn}_track_opt "$_subcmd" "$_opt" "$_val"`);
    if (hasArrayExpand) {
      lines.push(`            __${fn}_track_array_expand "$_subcmd" "$_opt" "$_val"`);
    }
  }
  lines.push(`            set _j (math $_j + 1); continue`);
  lines.push(`        end`);
  lines.push(`        if string match -q -- '-*' "$_w"`);
  lines.push(`            set -a _used_opts "$_w"`);
  lines.push(`            if __${fn}_opt_takes_value "$_subcmd" "$_w"`);
  lines.push(`                set -l _next ""`);
  lines.push(`                set -l _next_idx (math $_j + 1)`);
  lines.push(`                if test $_next_idx -le (count $_args)`);
  lines.push(`                    set _next "$_args[$_next_idx]"`);
  lines.push(`                end`);
  // Mirror the runtime parser: a token starting with `-` is the next
  // option, not this option's value. Skip/track only when the next
  // token looks like a value.
  lines.push(`                if test -n "$_next"; and not string match -q -- '-*' "$_next"`);
  lines.push(`                    set _skip_next 1`);
  if (hasExpand) {
    lines.push(`                    __${fn}_track_opt "$_subcmd" "$_w" "$_next"`);
    if (hasArrayExpand) {
      lines.push(`                    if test $_j -lt $_limit`);
      lines.push(`                        __${fn}_track_array_expand "$_subcmd" "$_w" "$_next"`);
      lines.push(`                    end`);
    }
  }
  lines.push(`                end`);
  lines.push(`            end`);
  lines.push(`            set _j (math $_j + 1); continue`);
  lines.push(`        end`);
  if (routeEntries.length > 0) {
    lines.push(`        if __${fn}_is_subcmd "$_subcmd" "$_w"`);
    lines.push(
      `            test -n "$_subcmd"; and set _subcmd "$_subcmd:$_w"; or set _subcmd "$_w"`,
    );
    lines.push(`            set _used_opts; set _pos_count 0`);
    if (hasExpand) {
      // Clear sibling-tracker state when descending into a subcommand:
      // `dependsOn` is scoped to siblings on the same command frame, so
      // letting a parent's `--env` bleed into a child with its own `--env`
      // would feed the wrong value into the child's expand lookup.
      for (const t of trackedFields) {
        lines.push(`            set -e _arg_values_${sanitize(t.fieldName)}`);
      }
      if (hasArrayExpand) {
        for (const spec of arrayExpandSpecs) {
          lines.push(`            set -e _used_field_keys_${sanitize(spec.fieldName)}`);
          // Per-frame seen flag also clears so global hosts pick up the
          // "first write replaces inherited array" semantics in the new
          // frame.
          lines.push(`            set -e _global_arr_seen_${sanitize(spec.fieldName)}`);
        }
      }
    }
    lines.push(`        else`);
    if (hasExpand) {
      lines.push(`            __${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"`);
    }
    lines.push(`            set _pos_count (math $_pos_count + 1)`);
    lines.push(`        end`);
  } else {
    if (hasExpand) {
      lines.push(`        __${fn}_track_pos "$_subcmd" "$_pos_count" "$_w"`);
    }
    lines.push(`        set _pos_count (math $_pos_count + 1)`);
  }
  lines.push(`        set _j (math $_j + 1)`);
  lines.push(`    end`);
  lines.push(``);

  // Route to subcommand handler (all nested paths)
  lines.push(`    switch "$_subcmd"`);
  for (const r of routeEntries) {
    lines.push(`        case "${r.pathStr}"; __${fn}_complete_${r.funcSuffix}`);
  }
  lines.push(`        case '*'; __${fn}_complete_root`);
  lines.push(`    end`);
  lines.push(`end`);
  lines.push(``);

  // Register completion
  lines.push(`# Clear existing completions`);
  lines.push(`complete -e -c ${programName}`);
  lines.push(``);
  lines.push(`# Register completion`);
  lines.push(`complete -c ${programName} -f -a '(__fish_${fn}_complete)'`);
  lines.push(``);

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
