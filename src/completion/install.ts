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
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import type { AnyCommand, ArgsSchema } from "../types.js";
import { resolveBinPath } from "./header.js";
import { generateCompletion } from "./index.js";
import { defaultCacheDir } from "./loader.js";
import type { BundledWorkerOptions, CompletionMode, ShellType } from "./types.js";

export interface InstallContext {
  rootCommand: AnyCommand;
  programName: string;
  programVersion?: string | undefined;
  cacheDir?: string | undefined;
  binPath?: string | undefined;
  globalArgsSchema?: ArgsSchema | undefined;
  bundledWorker?: BundledWorkerOptions | undefined;
  targetPath?: string | undefined;
  completionMode?: CompletionMode | undefined;
  staticWorker?: { functionSuffix: string } | undefined;
  allowTargetCreate?: boolean | undefined;
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
    mode: ctx.completionMode ?? "dispatcher",
    includeDescriptions: true,
    ...(ctx.programVersion !== undefined && { programVersion: ctx.programVersion }),
    ...(ctx.binPath !== undefined && { binPath: ctx.binPath }),
    ...(ctx.cacheDir !== undefined && { cacheDir: ctx.cacheDir }),
    ...(ctx.globalArgsSchema !== undefined && { globalArgsSchema: ctx.globalArgsSchema }),
    ...(ctx.bundledWorker !== undefined && { bundledWorker: ctx.bundledWorker }),
    ...(ctx.staticWorker !== undefined && { staticWorker: ctx.staticWorker }),
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

function readCachedMode(path: string): CompletionMode | undefined {
  try {
    if (!existsSync(path)) return undefined;
    const head = readFileSync(path, "utf8").split("\n", 10).join("\n");
    const m = head.match(/^# politty-completion-mode: (dispatcher|static)$/m);
    if (m) return m[1] as CompletionMode;
    return undefined;
  } catch {
    return undefined;
  }
}

function readCachedBinPath(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    const head = readFileSync(path, "utf8").split("\n", 10).join("\n");
    const m = head.match(/^# politty-bin-path: (.*)$/m);
    return m ? m[1]! : null;
  } catch {
    return null;
  }
}

function isManagedTarget(path: string, programName: string, shell: ShellType): boolean {
  try {
    if (!existsSync(path)) return false;
    const lines = readFileSync(path, "utf8")
      .split("\n", 8)
      .map((line) => line.trimEnd());
    return (
      lines.some((line) => /^# politty-completion-version: \S+$/.test(line)) &&
      lines.includes(`# program: ${programName}`) &&
      lines.includes(`# shell: ${shell}`)
    );
  } catch {
    return false;
  }
}

/**
 * Rewrite the cache only when stale. Used by:
 *   - `<program> __refresh-completion <shell>` (the hidden subcommand
 *     spawned both by the rc loader and by the runMain background hook)
 *
 * Caller is responsible for gating: the runMain hook (`maybeSpawnRefresh`)
 * checks `hasManagedCache` before spawning so we don't silently create
 * a fish autoload the user never opted into. The rc loader / fish
 * autoload only run after the user has installed completion in the
 * first place, so they're allowed to refresh unconditionally.
 *
 * Must never throw — a stale completion is fine, a crash isn't.
 */
export function refreshIfStale(ctx: InstallContext, shell: ShellType): void {
  try {
    const target = ctx.targetPath
      ? existsSync(ctx.targetPath)
        ? realpathSync(ctx.targetPath)
        : ctx.targetPath
      : installPath(ctx.programName, shell, ctx.cacheDir);
    if (ctx.targetPath && existsSync(target) && !isManagedTarget(target, ctx.programName, shell)) {
      return;
    }
    if (ctx.targetPath && !existsSync(target) && !ctx.allowTargetCreate) return;
    const binPath = resolveBinPath(ctx.programName, ctx.binPath);
    if (!binPath) return;
    let currentSig: string;
    try {
      currentSig = Math.floor(statSync(binPath).mtimeMs / 1000).toString();
    } catch {
      return;
    }
    if (readCachedSig(target) === currentSig && readCachedBinPath(target) === binPath) return;
    // A managed target that already exists but carries no mode header predates
    // dispatcher mode — keep it static so an upgrade + self-refresh does not
    // silently rewrite a user's static completion into a dispatcher one. Only a
    // fresh install (no existing target) defaults to dispatcher.
    const completionMode =
      ctx.completionMode ??
      readCachedMode(target) ??
      (existsSync(target) ? "static" : "dispatcher");
    writeAtomic(target, generateScript({ ...ctx, completionMode }, shell));
  } catch {
    // Best-effort.
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
