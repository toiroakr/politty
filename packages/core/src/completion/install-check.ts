/**
 * Lightweight, sync-safe subset of the on-disk install/refresh helpers.
 *
 * Split out from `install.ts` so the runMain background-refresh hook
 * (`with-completion-command.ts`) can gate its detached-spawn decision
 * without statically pulling in `generateCompletion` (and therefore the
 * bash/zsh/fish generators) — `install.ts` imports that for the heavier
 * `install`/`refreshIfStale` functions, which only run inside the
 * `completion`/`__refresh-completion` subcommands.
 *
 * All file I/O is best-effort: failures fall through silently. A stale
 * (or missing) cache is preferable to crashing the user's shell.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { defaultCacheDir } from "./cache-dir.js";
import type { ShellType } from "./types.js";

/**
 * Resolve where a script for the given shell should live on disk.
 *
 * - bash/zsh: `<cacheDir>/completion.<shell>` — sourced by the rc loader.
 * - fish:    `$__fish_config_dir/completions/<program>.fish` — autoloaded
 *            by fish on TAB. We approximate `$__fish_config_dir` from
 *            `$XDG_CONFIG_HOME` / `$HOME`.
 */
export function installPath(programName: string, shell: ShellType, cacheDir?: string): string {
  if (shell === "fish") {
    const cfg = process.env.XDG_CONFIG_HOME ?? `${process.env.HOME ?? ""}/.config`;
    return join(cfg, "fish", "completions", `${programName}.fish`);
  }
  const dir = cacheDir ?? defaultCacheDir(programName);
  return join(dir, `completion.${shell}`);
}

/**
 * Read the first ~5 lines of an existing cache file and return its
 * embedded bin-sig. Returns `null` when the file is missing, unreadable,
 * or doesn't have a sig header.
 */
export function readCachedSig(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const head = readFileSync(path, "utf8").split("\n", 6).join("\n");
    const m = head.match(/^# politty-bin-sig: (\S+)/m);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

/**
 * Returns true when a politty-managed cache file already exists on disk
 * for the given shell — i.e. the user has installed completion via
 * `<program> completion <shell> --install` or the rc loader has already
 * sourced one. Used by the runMain background hook to avoid spawning
 * the refresher (and thereby silently creating files) on plain CLI runs
 * the user never opted into.
 */
export function hasManagedCache(
  ctx: { programName: string; cacheDir?: string | undefined },
  shell: ShellType,
): boolean {
  const target = installPath(ctx.programName, shell, ctx.cacheDir);
  return readCachedSig(target) !== null;
}

/**
 * Spawn a detached child process that runs `<program> __refresh-completion <shell>`.
 * The child is fully decoupled (`stdio: "ignore"` + `unref()`), so it
 * outlives the parent without holding any handles.
 *
 * Caller is expected to gate this on the right conditions (interactive
 * shell, not running inside `__complete` itself, etc.).
 *
 * Returns `void` and never throws — even spawn failures are absorbed.
 */
export function spawnBackgroundRefresh(programArgv0: string, shell: ShellType): void {
  try {
    const child = spawn(process.execPath, [programArgv0, "__refresh-completion", shell], {
      detached: true,
      stdio: "ignore",
      // Inherit the env so XDG_CACHE_HOME / HOME / etc. flow through.
    });
    child.unref();
  } catch {
    // Best-effort.
  }
}
