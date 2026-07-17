/**
 * Node.js on-disk compile cache (V8 code cache) helpers.
 *
 * `node:module`'s `enableCompileCache` (Node.js >= 22.8.0) persists compiled
 * bytecode to disk so warm starts skip recompilation. Because ESM static
 * import graphs are compiled during the link phase — before any user code
 * runs — enabling the cache inside `runMain` only covers modules imported
 * *after* the call (e.g. `lazy()` subcommands). To cover the whole CLI,
 * enable it from a minimal bin shim that dynamically imports the real entry:
 *
 * ```ts
 * #!/usr/bin/env node
 * import { enableCompileCache } from "politty/compile-cache";
 *
 * enableCompileCache("my-cli");
 * await import("./cli.js");
 * ```
 *
 * This module must stay dependency-free (node builtins only) so the shim's
 * static graph — the part that can never be cached — stays tiny.
 */

import nodeModule from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Options for {@link enableCompileCache}.
 */
export interface CompileCacheOptions {
  /**
   * Program name used to derive the default cache directory
   * (`${XDG_CACHE_HOME:-$HOME/.cache}/<sanitized programName>/node-compile-cache`
   * — see {@link compileCacheDir} for how the name is sanitized).
   * Ignored when `cacheDir` is set.
   */
  programName?: string;
  /** Explicit cache directory (takes precedence over `programName`). */
  cacheDir?: string;
}

/**
 * Result of {@link enableCompileCache}.
 */
export interface CompileCacheResult {
  /** Whether the compile cache is active for this process. */
  enabled: boolean;
  /** Directory the cache is (or was already) persisted to, when known. */
  directory?: string;
}

/**
 * Reduce a program name to a single safe path segment. Path separators and
 * a leading scope marker are collapsed (`@scope/cli` → `scope-cli`) so the
 * name cannot escape the cache root; names that reduce to nothing (or to
 * `.`/`..`) yield `undefined`. Realistic command names pass through
 * unchanged.
 */
function sanitizeProgramName(programName: string): string | undefined {
  const safe = programName
    .replace(/^@/, "")
    .replace(/[/\\]+/g, "-")
    .trim();
  if (!safe || /^[.-]+$/.test(safe)) return undefined;
  return safe;
}

/**
 * Compute the cache directory for a program following the same XDG
 * convention as the shell-completion dispatcher scripts
 * (`src/completion/dispatcher.ts`), so direct CLI runs and completion
 * workers share one warm cache:
 * `${XDG_CACHE_HOME:-$HOME/.cache}/<sanitized programName>/node-compile-cache`.
 * The program name is first reduced to a single safe path segment by
 * {@link sanitizeProgramName} (e.g. `@scope/cli` → `scope-cli`); realistic
 * command names pass through unchanged.
 *
 * Returns `undefined` when no home directory can be resolved or the program
 * name does not reduce to a safe path segment; callers fall back to Node's
 * default location (`NODE_COMPILE_CACHE` or the OS tmpdir).
 */
export function compileCacheDir(programName: string): string | undefined {
  const safeName = sanitizeProgramName(programName);
  if (safeName === undefined) return undefined;
  const xdg = process.env.XDG_CACHE_HOME;
  if (xdg) return join(xdg, safeName, "node-compile-cache");
  try {
    const home = homedir();
    if (!home) return undefined;
    return join(home, ".cache", safeName, "node-compile-cache");
  } catch {
    return undefined;
  }
}

/**
 * Enable the Node.js on-disk compile cache for this process.
 *
 * - No-ops (returns `{ enabled: false }`) on runtimes without
 *   `module.enableCompileCache` (Node.js < 22.8.0) and never throws.
 * - When the `NODE_COMPILE_CACHE` environment variable is set it always
 *   wins, keeping runs spawned by completion scripts (which set the same
 *   variable) consistent with direct runs.
 * - Repeat calls are harmless: Node keeps the directory from the first
 *   successful call.
 *
 * @param options - Program name (string shorthand) or {@link CompileCacheOptions}.
 */
export function enableCompileCache(options?: string | CompileCacheOptions): CompileCacheResult {
  const opts: CompileCacheOptions =
    typeof options === "string" ? { programName: options } : (options ?? {});
  try {
    const enable = nodeModule.enableCompileCache;
    if (typeof enable !== "function") return { enabled: false };
    let dir: string | undefined;
    if (!process.env.NODE_COMPILE_CACHE) {
      dir =
        opts.cacheDir ??
        (opts.programName !== undefined ? compileCacheDir(opts.programName) : undefined);
    }
    const result = dir === undefined ? enable() : enable(dir);
    const status = nodeModule.constants?.compileCacheStatus;
    const enabled =
      status !== undefined
        ? result.status === status.ENABLED || result.status === status.ALREADY_ENABLED
        : result.status === 0 || result.status === 1;
    return {
      enabled,
      ...(result.directory !== undefined && { directory: result.directory }),
    };
  } catch {
    return { enabled: false };
  }
}
