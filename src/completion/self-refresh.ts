/**
 * Self-refresh guards embedded in generated bash/zsh scripts.
 *
 * These guards make the default `completion <shell>` output safe to
 * save as a static completion file: when the CLI binary changes, the
 * script asks the hidden refresh subcommand to rewrite the sourced
 * file in place, then sources the fresh file and stops executing the
 * stale body.
 */

import { binEnvVarName, sanitize } from "./extractor.js";
import { computeBinSig, resolveBinPath } from "./header.js";
import { statSigExpr } from "./shell-shared.js";

interface SelfRefreshOptions {
  programName: string;
  binPath?: string | undefined;
}

export function generateBashSelfRefresh(opts: SelfRefreshOptions): string[] {
  const { programName, binPath } = opts;
  const fn = sanitize(programName);
  const envName = binEnvVarName(fn);
  const sig = computeBinSig(resolveBinPath(programName, binPath));
  const refreshFn = `__${fn}_self_refresh`;

  return [
    `${refreshFn}() {`,
    `    local _self _bin _sig`,
    `    _self=\${BASH_SOURCE[0]:-}`,
    `    [[ -n "$_self" && -f "$_self" ]] || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# politty-completion-version:" || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# program: ${programName}" || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# shell: bash" || return 1`,
    `    _bin="\${${envName}:-$(type -P ${programName} 2>/dev/null)}"`,
    `    [[ -n "$_bin" ]] || return 1`,
    `    _sig=${statSigExpr("$_bin", { shell: "posix" })} || return 1`,
    `    [[ "$_sig" != "${sig}" ]] || return 1`,
    `    "$_bin" __refresh-completion bash "$_self" --static 2>/dev/null || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# politty-bin-sig: $_sig" || return 1`,
    `    source "$_self" 2>/dev/null || return 1`,
    `    return 0`,
    `}`,
    `if ${refreshFn}; then`,
    `    unset -f ${refreshFn}`,
    `    return 0 2>/dev/null || true`,
    `else`,
    `    unset -f ${refreshFn}`,
    `fi`,
    ``,
  ];
}

export function generateZshSelfRefresh(opts: SelfRefreshOptions): string[] {
  const { programName, binPath } = opts;
  const fn = sanitize(programName);
  const envName = binEnvVarName(fn);
  const completionFn = `_${programName}`;
  const sig = computeBinSig(resolveBinPath(programName, binPath));
  const refreshFn = `__${fn}_self_refresh`;

  return [
    `${refreshFn}() {`,
    `    emulate -L zsh`,
    `    setopt local_options no_aliases`,
    `    local _self _bin _sig`,
    `    _self="\${(%):-%x}"`,
    `    [[ -n "$_self" && -f "$_self" ]] || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# politty-completion-version:" || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# program: ${programName}" || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# shell: zsh" || return 1`,
    `    _bin="\${${envName}:-$(whence -p ${programName} 2>/dev/null)}"`,
    `    [[ -n "$_bin" ]] || return 1`,
    `    _sig=${statSigExpr("$_bin", { shell: "posix" })} || return 1`,
    `    [[ "$_sig" != "${sig}" ]] || return 1`,
    `    "$_bin" __refresh-completion zsh "$_self" --static 2>/dev/null || return 1`,
    `    head -n 8 "$_self" 2>/dev/null | grep -qF "# politty-bin-sig: $_sig" || return 1`,
    `    source "$_self" 2>/dev/null || return 1`,
    `    ${completionFn} "$@"`,
    `    return 0`,
    `}`,
    `if ${refreshFn} "$@"; then`,
    `    unfunction ${refreshFn} 2>/dev/null`,
    `    return 0 2>/dev/null || true`,
    `else`,
    `    unfunction ${refreshFn} 2>/dev/null`,
    `fi`,
    ``,
  ];
}
