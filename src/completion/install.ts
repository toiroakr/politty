/**
 * On-disk install + refresh helpers.
 *
 * `install` writes the generated script to its canonical cache /
 * autoload path. `refresh` is the body of the `__refresh-completion`
 * hidden subcommand and the runMain background hook — it regenerates
 * the cache only when the binary's mtime no longer matches the
 * embedded `# politty-bin-sig:` header.
 *
 * All file I/O is best-effort: failures fall through silently. A stale
 * (or missing) cache is preferable to crashing the user's shell.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AnyCommand } from "../types.js";
import { computeBinSig } from "./header.js";
import { generateCompletion } from "./index.js";
import { defaultCacheDir } from "./loader.js";
import type { ShellType } from "./types.js";

export interface InstallContext {
  rootCommand: AnyCommand;
  programName: string;
  programVersion?: string | undefined;
  cacheDir?: string | undefined;
  binPath?: string | undefined;
}

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

/** Atomic write: tmp file in the same dir, then rename. */
function writeAtomic(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  writeFileSync(tmp, content);
  renameSync(tmp, path);
}

function generateScript(ctx: InstallContext, shell: ShellType): string {
  return generateCompletion(ctx.rootCommand, {
    shell,
    programName: ctx.programName,
    includeDescriptions: true,
    ...(ctx.programVersion !== undefined && { programVersion: ctx.programVersion }),
    ...(ctx.binPath !== undefined && { binPath: ctx.binPath }),
    ...(ctx.cacheDir !== undefined && { cacheDir: ctx.cacheDir }),
  }).script;
}

/** Write the script for `shell` to its install path. Returns the path. */
export function install(ctx: InstallContext, shell: ShellType): string {
  const target = installPath(ctx.programName, shell, ctx.cacheDir);
  writeAtomic(target, generateScript(ctx, shell));
  return target;
}

/**
 * Read the first ~5 lines of an existing cache file and return its
 * embedded bin-sig. Returns `null` when the file is missing, unreadable,
 * or doesn't have a sig header.
 */
function readCachedSig(path: string): string | null {
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
 * Rewrite the cache only when stale. Used by:
 *   - `<program> __refresh-completion <shell>` (the hidden subcommand)
 *   - the background spawn from runMain
 *
 * Both call paths must never throw — a stale completion is fine, a
 * crash isn't.
 */
export function refreshIfStale(ctx: InstallContext, shell: ShellType): void {
  try {
    const target = installPath(ctx.programName, shell, ctx.cacheDir);
    const binPath = ctx.binPath ?? process.argv[1] ?? "";
    if (!binPath) return;
    let currentSig: string;
    try {
      currentSig = Math.floor(statSync(binPath).mtimeMs / 1000).toString();
    } catch {
      return;
    }
    if (readCachedSig(target) === currentSig) return;
    writeAtomic(target, generateScript(ctx, shell));
  } catch {
    // Best-effort.
  }
}

/**
 * Detect the user's shell from $SHELL. Returns null if it isn't one of
 * the supported shells; callers should treat that as "skip refresh."
 */
export function detectShellEnv(): ShellType | null {
  const shell = (process.env.SHELL ?? "").split("/").pop()?.toLowerCase() ?? "";
  if (shell.includes("bash")) return "bash";
  if (shell.includes("zsh")) return "zsh";
  if (shell.includes("fish")) return "fish";
  return null;
}

/**
 * Spawn a detached child process that runs `<program> __refresh-completion <shell>`.
 * The child is fully decoupled (`stdio: "ignore"` + `unref()`), so it
 * outlives the parent without holding any handles.
 *
 * Caller is expected to gate this on the right conditions (interactive
 * shell, not running inside `__complete` itself, etc.).
 *
 * Re-exports `void` and never throws — even spawn failures are absorbed.
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

/** computeBinSig is re-exported so install.ts is self-contained for callers. */
export { computeBinSig };
