/**
 * Helpers shared across the bash/zsh/fish completion generators.
 *
 * The three generators are necessarily distinct (each shell has its own
 * syntax) but they share a handful of building blocks: ANSI-C literal
 * encoding, the `--alias`/`-a` token shape, and the resolved-dep records
 * that drive expand lookups. Keeping these in one place avoids drift
 * when one generator gets a fix that the others should mirror.
 */

import type { ValueCompletion } from "./types.js";

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
 * Resolve each `dependsOn` entry to its globality at codegen time. The
 * host's globality fully determines the answer — `resolveExpandTargets`
 * resolves global hosts against the global options list (no positionals)
 * and local hosts against their own siblings (before global propagation)
 * — so all of a host's deps share its scope.
 */
export function resolveExpandDepGlobality(
  vc: ValueCompletion,
  hostIsGlobal: boolean,
): readonly ResolvedExpandDep[] {
  if (vc.type !== "expand") return [];
  return vc.dependsOn.map((name) => ({ name, isGlobal: hostIsGlobal }));
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
