/**
 * Helpers shared across the bash/zsh/fish completion generators.
 *
 * The three generators are necessarily distinct (each shell has its own
 * syntax) but they share a handful of building blocks: ANSI-C literal
 * encoding, the `--alias`/`-a` token shape, and the resolved-dep records
 * that drive expand lookups. Keeping these in one place avoids drift
 * when one generator gets a fix that the others should mirror.
 */

import { toCamelCase } from "../core/schema-extractor.js";
import type { CompletableOption, ValueCompletion } from "./types.js";

/**
 * Resolved sibling dep used by an `expand` value completion. Paired with
 * a globality bit so the shell-side lookup reads from the matching
 * bucket: local deps from `_arg_values`, global deps from
 * `_global_arg_values`.
 */
export interface ResolvedExpandDep {
  readonly name: string;
  readonly isGlobal: boolean;
}

/**
 * Resolve each `dependsOn` entry to its globality at codegen time. A
 * global host's deps all live in the global namespace. A local host
 * may declare deps against a propagated global (its sibling index
 * includes globals); those individual deps must read from the global
 * bucket even when the host itself is local — the tracker only ever
 * writes the global value into \`_global_arg_values_<name>\`, so a
 * lookup against the local bucket would see the empty key.
 *
 * Local-precedence matches `buildSiblingIndex` in `expand-resolver.ts`:
 * a dep name that exists on a local field (option OR positional) at the
 * frame resolves to the local, even if a same-named global also exists.
 * Marking such a dep as global would route the lookup at the wrong
 * bucket and produce no candidates.
 */
export function resolveExpandDepGlobality(
  vc: ValueCompletion | undefined,
  hostIsGlobal: boolean,
  frameOptions: readonly CompletableOption[],
  framePositionals: readonly { name: string }[] = [],
): readonly ResolvedExpandDep[] {
  if (vc?.type !== "expand") return [];
  const globalOptionNames = new Set<string>();
  const localFieldNames = new Set<string>();
  for (const o of frameOptions) {
    if (o.isGlobal === true) globalOptionNames.add(o.name);
    else localFieldNames.add(o.name);
  }
  for (const p of framePositionals) localFieldNames.add(p.name);
  return vc.dependsOn.map((name) => ({
    name,
    isGlobal: hostIsGlobal || (globalOptionNames.has(name) && !localFieldNames.has(name)),
  }));
}

/**
 * Encode a string as an ANSI-C shell literal (`$'…'`) with backslash
 * escapes. Used by bash and zsh to embed expand-table values so newlines,
 * the unit-separator key delimiter, and other control characters survive
 * verbatim.
 */
export function ansiC(s: string): string {
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

/**
 * Render an alias as its CLI token form: single-char aliases become `-x`,
 * multi-char aliases become `--long`. Mirrors the parser's accepted shapes
 * and is the bare-token form (no quoting) used inside generated case
 * patterns.
 */
export function aliasToken(alias: string): string {
  return alias.length === 1 ? `-${alias}` : `--${alias}`;
}

/**
 * Single-character tokens (`-x`) that global options at this frame own.
 * Shared between availability-guard and value-completion token filtering:
 * both paths must agree on which short forms `separateGlobalArgs` routes
 * to a global rather than a same-letter local.
 */
export function globalShortTokens(frameOptions: readonly CompletableOption[]): Set<string> {
  const out = new Set<string>();
  for (const o of frameOptions) {
    if (o.isGlobal !== true) continue;
    if (o.cliName.length === 1) out.add(`-${o.cliName}`);
    for (const a of o.alias ?? []) {
      if (a.length === 1) out.add(`-${a}`);
    }
  }
  return out;
}

/**
 * Build the quoted-token list bash/zsh/fish pass to `__<fn>_not_used` to
 * decide whether an option (and its negation form, if any) is still
 * available. Quoting style (`"…"`) is identical across all three shells,
 * so the helper lives here instead of being re-derived per generator.
 */
export function quotedAvailabilityTokens(
  cliName: string,
  aliases: readonly string[] | undefined,
  negation: string | undefined,
  options?: {
    isGlobal?: boolean;
    /**
     * Other options at the same frame. Used to drop short tokens that a
     * global owns from a LOCAL's availability guard — otherwise consuming
     * \`-e\` (routed to a global) would hide the local's still-available
     * \`--e\` suggestion.
     */
    frameOptions?: readonly CompletableOption[];
  },
): string[] {
  const tokens = new Set<string>([`--${cliName}`]);
  // Mirror every spelling the runtime aliasMap accepts so the
  // used-option guard covers each form a value-completion case (or
  // tracker) might consume. Without this, the option-name suggestion
  // path still offers the canonical \`--cliName\` after the user
  // consumed it as \`-x\` / \`--f\` / \`--toBe\`.
  if (cliName.length === 1) tokens.add(`-${cliName}`);
  if (cliName.includes("-")) tokens.add(`--${toCamelCase(cliName)}`);
  if (aliases) {
    for (const a of aliases) {
      tokens.add(aliasToken(a));
      if (a.length === 1) tokens.add(`--${a}`);
      else if (a.includes("-")) tokens.add(`--${toCamelCase(a)}`);
    }
  }
  if (negation) {
    tokens.add(`--${negation}`);
    if (negation.includes("-")) tokens.add(`--${toCamelCase(negation)}`);
  }
  // Drop tokens runtime would NOT route to this option. For a LOCAL
  // option, a short token owned by a global at the same frame is
  // never consumed locally. For a GLOBAL option, every spelling a
  // local at the frame owns (long-form cliName, explicit aliases) is
  // routed to the local — guarding on it would falsely suppress the
  // global's canonical suggestion after the local was used.
  if (options?.frameOptions) {
    if (options.isGlobal === true) {
      for (const o of options.frameOptions) {
        if (o.isGlobal === true) continue;
        for (const t of localOwnedTokens(o.cliName, o.alias)) tokens.delete(t);
      }
    } else {
      const globalShort = globalShortTokens(options.frameOptions);
      if (globalShort.size > 0) {
        const localExplicitShort = new Set(
          (aliases ?? []).filter((a) => a.length === 1).map((a) => `-${a}`),
        );
        for (const g of globalShort) {
          if (!localExplicitShort.has(g)) tokens.delete(g);
        }
      }
    }
  }
  return [...tokens].map((t) => `"${t}"`);
}

/**
 * Tokens the runtime's `separateGlobalArgs` would consider locally
 * owned at the leaf — long-form cliName plus every EXPLICIT alias
 * spelling. Mirrors `localShadowingTokens` in extractor.ts but is
 * kept here so the availability-guard path does not pull in the
 * extractor module. Excludes the auto-derived `-x` for a 1-char
 * cliName because that short form lives in the local aliasMap only
 * when an explicit alias declares it.
 */
function localOwnedTokens(cliName: string, aliases: readonly string[] | undefined): string[] {
  const out = [`--${cliName}`];
  if (cliName.includes("-")) out.push(`--${toCamelCase(cliName)}`);
  if (aliases) {
    for (const a of aliases) {
      out.push(aliasToken(a));
      if (a.length === 1) out.push(`--${a}`);
      else if (a.includes("-")) out.push(`--${toCamelCase(a)}`);
    }
  }
  return out;
}
