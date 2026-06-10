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
  walkOptTakesValueRows,
} from "./extractor.js";
import { buildHeaderLines, computeBinSig, resolveBinPath } from "./header.js";
import {
  optionExpandLocation,
  positionalExpandLocation,
  quotedAvailabilityTokens,
  type BaseExpandLocation,
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
  location?: BaseExpandLocation,
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
          // A candidate that ends with `=` is a bare key (no value yet).
          // Skip it in the value-stage branch so the picker doesn't
          // surface the key the user already typed.
          const isBareKey = keyPart.length > 0 && c.value.length === eqIdx + 1;

          if (!isBareKey) {
            fullLines.push(...wrapWithDedup(echoLine, keyPart));
          }

          if (keyPart.length === 0) {
            // Candidate without `=` — same in both branches.
            keyOnlyLines.push(`        ${echoLine}`);
          } else if (!seenKeys.has(keyPart)) {
            seenKeys.add(keyPart);
            // Reuse the original description on the collapsed key form.
            keyOnlyLines.push(...wrapWithDedup(printfLine(`${keyPart}=`, c.description), keyPart));
          }
        }

        // Split into two runtime branches whenever the two stages differ.
        // They are identical only when every candidate has no `=` (no key
        // collapse and no bare-key drop); in that case a single branch
        // suffices.
        const branchesDiffer =
          fullLines.length !== keyOnlyLines.length ||
          fullLines.some((l, i) => l !== keyOnlyLines[i]);
        if (branchesDiffer) {
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
function optionValueCases(
  options: CompletableOption[],
  positionals: readonly CompletablePositional[],
  fn: string,
): string[] {
  const lines: string[] = [];
  for (const opt of options) {
    if (!opt.takesValue || !opt.valueCompletion) continue;
    const valLines = fishValueLines(
      opt.valueCompletion,
      fn,
      optionExpandLocation(opt, options, positionals),
    );
    if (valLines.length === 0) continue;

    // Mirror the bash/zsh tracker emission: use every CLI token the
    // runtime's aliasMap accepts so a value-completion trigger fires
    // for every valid spelling of this option (1-char cliName as `-x`,
    // 1-char alias long form `--f`, camelCase of hyphenated names).
    const tokens = effectiveOptionTokens(opt, options);
    // No surviving spelling means no condition; an empty `if`
    // generates invalid fish syntax.
    if (tokens.length === 0) continue;
    const cond = tokens.map((t) => `test "$_prev" = "${t}"`).join("; or ");

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
    const valLines = fishValueLines(
      pos.valueCompletion,
      fn,
      positionalExpandLocation(pos, options, positionals),
    );
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
      // Skip the suggestion when `--name`'s long form was filtered out
      // of the routing-aware token set — emitting it would point the
      // user at an option the runtime routes elsewhere.
      if (!checks.includes(`"--${e.name}"`)) continue;
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
  lines.push(...optionValueCases(sub.options, sub.positionals, fn));
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
  for (const row of walkOptTakesValueRows(sub, parentPath)) {
    const patterns = row.tokens.map((t) => `"${row.parentPath}:${t}"`);
    lines.push(`        case ${patterns.join(" ")}`);
    lines.push(`            return 0`);
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
  lines.push(
    ...buildHeaderLines({
      programName,
      shell: "fish",
      binPath: options.binPath,
      programVersion: options.programVersion,
    }),
  );
  lines.push(`# Generated by politty`);
  lines.push(``);

  // Self-rewriting autoload header. Fish autoloads completion files
  // from `$__fish_config_dir/completions/<prog>.fish` lazily, so the
  // refresh check has to live in the file itself. When the binary's
  // mtime no longer matches the embedded sig, we regenerate the file
  // in place via the hidden __refresh-completion subcommand, then
  // `source` the rewritten file so the *current* session picks up the
  // new definitions, and `return` from this script so the rest of the
  // *old* file (stale helper functions and `complete` registrations)
  // doesn't run on top of the freshly sourced new definitions.
  // Failures are silent — a stale completion is preferable to a
  // shell-startup error.
  //
  // We invoke __refresh-completion (internal) instead of
  // `<bin> completion fish`: the foreground completion command runs
  // user setup/cleanup/prompt and validates required globalArgs, which
  // can fail or block when triggered from autoload.
  const sig = computeBinSig(resolveBinPath(programName, options.binPath));
  const refreshFn = `__${fn}_refresh_completion`;
  lines.push(`function ${refreshFn} --no-scope-shadowing`);
  lines.push(`    set -l _bin (command -v ${programName})`);
  lines.push(`    test -z "$_bin"; and return 1`);
  // `-L` follows symlinks so the shell-side mtime matches Node's
  // `fs.statSync`, mirroring the bash/zsh loader. Probe order matches
  // the bash/zsh loader: GNU (`-c`) first because `-f` is filesystem
  // mode there and would otherwise dump filesystem info into `_sig`.
  lines.push(
    `    set -l _sig (stat -L -c '%Y' "$_bin" 2>/dev/null; or stat -L -f '%m' "$_bin" 2>/dev/null)`,
  );
  lines.push(`    test "$_sig" = "${sig}"; and return 1`);
  lines.push(`    set -l _target (status current-filename)`);
  lines.push(`    test -n "$_target"; and test -f "$_target"; or return 1`);
  lines.push(`    "$_bin" __refresh-completion fish "$_target" 2>/dev/null`);
  lines.push(`    and source "$_target" 2>/dev/null`);
  lines.push(`    and return 0`);
  lines.push(`    return 1`);
  lines.push(`end`);
  lines.push(`${refreshFn}`);
  lines.push(`set -l _politty_refreshed $status`);
  lines.push(`functions -e ${refreshFn}`);
  // `return` from a sourced fish script aborts the rest of the source
  // call, so the stale `complete -c` lines below do not execute when
  // the fresh script has already been sourced.
  lines.push(`test $_politty_refreshed -eq 0; and return`);
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
    // Boolean flag (not a counter): the `Default` (directive 0) fallback
    // below only branches on "any candidate emitted yet?", so a single
    // 0/1 flip avoids a `math` invocation per resolver candidate.
    lines.push(`    set -l _emitted 0`);
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
    lines.push(`                set _emitted 1`);
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
    lines.push(`                set _emitted 1`);
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
    // Default directive (0) with no resolver candidates: fall back to
    // filename completion, mirroring the bash/zsh apply helpers. fish's
    // `-f` registration suppresses the automatic file fallback, so the
    // helper has to call `__fish_complete_path` itself.
    lines.push(
      `    else if test $_emitted -eq 0; and test (math "bitand($_directive, ${CompletionDirective.NoFileCompletion})") -eq 0`,
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
    const trackerVar = (t: { fieldName: string; isGlobal: boolean }): string =>
      `${t.isGlobal ? "_global_arg_values_" : "_arg_values_"}${sanitize(t.fieldName)}`;
    lines.push(`function __${fn}_track_opt --no-scope-shadowing`);
    lines.push(`    switch "$argv[1]:$argv[2]"`);
    for (const t of trackedFields) {
      if (t.isPositional || !t.optionTokens || t.optionTokens.length === 0) continue;
      const cases = t.pathStrs.flatMap((p) => t.optionTokens!.map((n) => `"${p}:${n}"`)).join(" ");
      lines.push(`        case ${cases}`);
      lines.push(`            set -g ${trackerVar(t)} "$argv[3]"`);
    }
    lines.push(`    end`);
    lines.push(`end`);
    lines.push(``);
    lines.push(`function __${fn}_track_pos --no-scope-shadowing`);
    lines.push(`    switch "$argv[1]:$argv[2]"`);
    for (const t of trackedFields) {
      if (!t.isPositional) continue;
      const cases = t.pathStrs.map((p) => `"${p}:${t.position}"`).join(" ");
      lines.push(`        case ${cases}`);
      lines.push(`            set -g ${trackerVar(t)} "$argv[3]"`);
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
      if (spec.optionTokens.length === 0) continue;
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
  lines.push(...optionValueCases(root.options, root.positionals, fn));
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
    installInstructions: `# To enable auto-refreshing fish completions, run:
${programName} completion fish --install`,
  };
}
