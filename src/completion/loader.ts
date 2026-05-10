/**
 * Rc-loader generators (bash / zsh).
 *
 * These produce the small snippet a user adds once to `~/.bashrc` or
 * `~/.zshrc`. The snippet:
 *
 *   1. Looks up the binary on $PATH.
 *   2. Reads its mtime.
 *   3. If the on-disk completion cache is missing or its
 *      `# politty-bin-sig:` header differs, regenerates the cache by
 *      spawning the binary once.
 *   4. Sources the cache.
 *
 * All failure modes are silent no-ops so a broken / missing CLI never
 * blocks shell startup.
 */

import { sanitize } from "./extractor.js";
import type { ShellType } from "./types.js";

export interface LoaderOptions {
  programName: string;
  shell: ShellType;
  /**
   * Optional hardcoded cache directory. When omitted, the loader
   * derives `${XDG_CACHE_HOME:-$HOME/.cache}/<programName>` at runtime,
   * which is what most users want.
   */
  cacheDir?: string;
}

/**
 * Single-quote escape: `'` -> `'\''`. Inside single quotes the shell
 * performs no expansion at all, so `$`, backticks, and `$(...)` are
 * inert. Used for hardcoded paths because callers may sources them
 * from env / config — we must not let metachars in the path execute as
 * commands when the rc snippet is sourced.
 */
function shSingleQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function bashCachePathExpr(
  programName: string,
  cacheDir: string | undefined,
  shell: "bash" | "zsh",
): string {
  if (cacheDir) {
    return shSingleQuote(`${cacheDir}/completion.${shell}`);
  }
  return `"\${XDG_CACHE_HOME:-$HOME/.cache}/${programName}/completion.${shell}"`;
}

function generateBashLoader(opts: LoaderOptions): string {
  const fn = sanitize(opts.programName);
  const cache = bashCachePathExpr(opts.programName, opts.cacheDir, "bash");
  // `type -P` is path-only — it skips aliases, functions, and builtins.
  // `command -v` would surface the alias text or function name when the
  // user has shadowed the CLI in their rc, and the subsequent `stat`
  // would fail, leaving completions unsourced for that shell.
  //
  // `-L` follows symlinks so the shell-side mtime matches Node's
  // `fs.statSync`, which also follows symlinks. Without `-L`, BSD `stat`
  // (macOS) reports the symlink's own mtime, so package-manager bin
  // shims (npm/pnpm/etc.) would never match the embedded sig and the
  // cache would regenerate on every shell startup.
  //
  // Try GNU (`-c '%Y'`) before BSD (`-f '%m'`): GNU treats `-f` as
  // file-system mode, so `stat -L -f '%m' file` would emit filesystem
  // info on stdout *and* exit non-zero, causing the `||` fallback to
  // append a second line and break the header comparison.
  return `__${fn}_load_completion() {
    local _bin _cache _sig _hdr
    _bin=$(type -P ${opts.programName} 2>/dev/null)
    [[ -n "$_bin" ]] || return 0
    _cache=${cache}
    _sig=$(stat -L -c '%Y' "$_bin" 2>/dev/null || stat -L -f '%m' "$_bin" 2>/dev/null) || return 0
    _hdr="# politty-bin-sig: $_sig"
    if [[ ! -f "$_cache" ]] || ! head -5 "$_cache" 2>/dev/null | grep -qF "$_hdr"; then
        mkdir -p "$(dirname "$_cache")" 2>/dev/null || return 0
        "$_bin" completion bash > "$_cache.tmp.$$" 2>/dev/null \\
            && mv "$_cache.tmp.$$" "$_cache" \\
            || { rm -f "$_cache.tmp.$$" 2>/dev/null; return 0; }
    fi
    # shellcheck disable=SC1090
    source "$_cache"
}
__${fn}_load_completion
unset -f __${fn}_load_completion
`;
}

function generateZshLoader(opts: LoaderOptions): string {
  const fn = sanitize(opts.programName);
  const cache = bashCachePathExpr(opts.programName, opts.cacheDir, "zsh");
  // `whence -p` is the zsh equivalent of bash's `type -P` — path-only,
  // ignoring aliases / functions / builtins. See bash loader for the
  // rationale and for `-L` / stat probe-order.
  return `__${fn}_load_completion() {
    emulate -L zsh
    setopt local_options no_aliases
    local _bin _cache _sig _hdr
    _bin=$(whence -p ${opts.programName} 2>/dev/null)
    [[ -n "$_bin" ]] || return 0
    _cache=${cache}
    _sig=$(stat -L -c '%Y' "$_bin" 2>/dev/null || stat -L -f '%m' "$_bin" 2>/dev/null) || return 0
    _hdr="# politty-bin-sig: $_sig"
    if [[ ! -f "$_cache" ]] || ! head -5 "$_cache" 2>/dev/null | grep -qF "$_hdr"; then
        mkdir -p "$_cache:h" 2>/dev/null || return 0
        "$_bin" completion zsh > "$_cache.tmp.$$" 2>/dev/null \\
            && mv "$_cache.tmp.$$" "$_cache" \\
            || { rm -f "$_cache.tmp.$$" 2>/dev/null; return 0; }
    fi
    source "$_cache"
}
__${fn}_load_completion
unfunction __${fn}_load_completion
`;
}

/**
 * Build the rc-loader snippet for bash or zsh. Fish doesn't have an
 * rc-loader; instead, `<program> completion install fish` writes a
 * self-rewriting autoload file.
 */
export function generateLoader(opts: LoaderOptions): string {
  switch (opts.shell) {
    case "bash":
      return generateBashLoader(opts);
    case "zsh":
      return generateZshLoader(opts);
    case "fish":
      throw new Error(
        "fish does not use an rc loader. Run `<program> completion install fish` to write the self-refreshing autoload file instead.",
      );
  }
}

/**
 * Default cache file path (used by `completion install bash|zsh` and
 * the `__refresh-completion` subcommand). For fish, the install path
 * is `$__fish_config_dir/completions/<program>.fish` and is computed
 * inside `installPath()` instead.
 */
export function defaultCacheDir(programName: string): string {
  const xdg = process.env.XDG_CACHE_HOME ?? `${process.env.HOME ?? ""}/.cache`;
  return `${xdg}/${programName}`;
}
