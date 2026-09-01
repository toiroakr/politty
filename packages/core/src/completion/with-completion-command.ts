/**
 * `withCompletionCommand` — kept in its own lightweight module so the
 * package entry point (`../index.ts`) can export it without statically
 * pulling in the bash/zsh/fish generators, the dynamic completion engine,
 * or the on-disk install/refresh logic (`./index.ts` and everything it
 * imports).
 *
 * Each subcommand it registers is wrapped with `lazy()`: its metadata
 * (name, description, args schema) is available synchronously for help
 * text and completion generation, but the actual implementation — and the
 * heavy modules it needs — only loads the first time that subcommand runs.
 */

import { defineCommand } from "../core/command.js";
import { lazy } from "../lazy.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import { detectShell } from "./detect-shell.js";
import { completeArgsSchema } from "./dynamic/schema.js";
import { hasManagedCache, spawnBackgroundRefresh } from "./install-check.js";
import { completionArgsSchema, refreshArgsSchema, workerPathArgsSchema } from "./schemas.js";
import type { BundledWorkerOptions } from "./types.js";

/**
 * Options for withCompletionCommand
 */
export interface WithCompletionOptions {
  /** Override the program name (defaults to command.name) */
  programName?: string;
  /** Global args schema for deriving global options in completion */
  globalArgsSchema?: ArgsSchema;
  /**
   * Hardcode the cache directory used by the rc loader and the
   * background refresh. When omitted, the loader derives
   * `${XDG_CACHE_HOME:-$HOME/.cache}/<programName>` at runtime, which
   * is the right answer for almost every CLI.
   */
  cacheDir?: string;
  /** Program version embedded in the script header. */
  programVersion?: string;
  /** Published worker artifact lookup used by dispatcher mode. */
  bundledWorker?: BundledWorkerOptions;
}

/**
 * Wrap a command with a completion subcommand
 *
 * This avoids circular references that occur when a command references itself
 * in its subCommands (e.g., for completion generation).
 *
 * @param command - The command to wrap
 * @param options - Options including programName
 * @returns A new command with the completion subcommand added
 *
 * @example
 * ```typescript
 * const mainCommand = withCompletionCommand(
 *   defineCommand({
 *     name: "mycli",
 *     subCommands: { ... },
 *   }),
 * );
 * ```
 */
export function withCompletionCommand<T extends AnyCommand>(
  command: T,
  options?: string | WithCompletionOptions,
): T {
  // Support both string (programName) and options object for backwards compatibility
  const opts: WithCompletionOptions =
    typeof options === "string" ? { programName: options } : (options ?? {});

  const { programName, globalArgsSchema, cacheDir, programVersion, bundledWorker } = opts;
  const resolvedProgramName = programName ?? command.name;
  const extra: {
    cacheDir?: string;
    programVersion?: string;
    globalArgsSchema?: ArgsSchema;
    bundledWorker?: BundledWorkerOptions;
  } = {
    ...(cacheDir !== undefined && { cacheDir }),
    ...(programVersion !== undefined && { programVersion }),
    ...(globalArgsSchema !== undefined && { globalArgsSchema }),
    ...(bundledWorker !== undefined && { bundledWorker }),
  };

  const wrappedCommand = {
    ...command,
  } as T;

  wrappedCommand.subCommands = {
    ...command.subCommands,
    completion: lazy(
      defineCommand({
        name: "completion",
        description: "Generate shell completion script",
        args: completionArgsSchema,
        run() {},
      }),
      () =>
        import("./index.js").then((m) =>
          m.createCompletionCommand(wrappedCommand, programName, globalArgsSchema, extra),
        ),
    ),
    __complete: lazy(
      defineCommand({
        name: "__complete",
        args: completeArgsSchema,
        run() {},
      }),
      () =>
        import("./dynamic/index.js").then((m) =>
          m.createDynamicCompleteCommand(wrappedCommand, programName, globalArgsSchema),
        ),
    ),
    "__refresh-completion": lazy(
      defineCommand({
        name: "__refresh-completion",
        description: "(internal) Refresh the on-disk completion cache if stale.",
        args: refreshArgsSchema,
        run() {},
      }),
      () =>
        import("./index.js").then((m) =>
          m.createRefreshCompletionCommand(wrappedCommand, resolvedProgramName, extra),
        ),
    ),
    "__completion-worker-path": lazy(
      defineCommand({
        name: "__completion-worker-path",
        description: "(internal) Print the bundled completion worker path when available.",
        args: workerPathArgsSchema,
        run() {},
      }),
      () =>
        import("./index.js").then((m) =>
          m.createCompletionWorkerPathCommand(resolvedProgramName, extra),
        ),
    ),
  };

  wrappedCommand.runMainHook = (argv) => {
    maybeSpawnRefresh(argv, {
      programName: resolvedProgramName,
      ...(cacheDir !== undefined && { cacheDir }),
    });
  };

  return wrappedCommand;
}

/**
 * Background-refresh trigger fired from `runMain` via `runMainHook`.
 *
 * Skipped when:
 *   - the user is invoking `__complete` / `__refresh-completion` /
 *     `completion` themselves (avoids loops and double work)
 *   - $SHELL doesn't resolve to a known shell
 *   - the user opted out via $POLITTY_NO_COMPLETION_REFRESH
 *   - process.argv[1] is missing (shouldn't happen for normal CLIs)
 *   - no politty-managed cache exists yet — i.e. the user hasn't
 *     installed completion. Without this gate the detached child would
 *     create a fish autoload (or any cache file) on every CLI run,
 *     even though the user never opted in via `--install` or the rc loader.
 */
function maybeSpawnRefresh(
  argv: readonly string[],
  ctx: { programName: string; cacheDir?: string | undefined },
): void {
  if (process.env.POLITTY_NO_COMPLETION_REFRESH) return;

  const firstPositional = argv.find((a) => !a.startsWith("-"));
  if (
    firstPositional === "__complete" ||
    firstPositional === "__refresh-completion" ||
    firstPositional === "__completion-worker-path" ||
    firstPositional === "completion"
  ) {
    return;
  }

  const shell = detectShell();
  if (!shell) return;
  const argv0 = process.argv[1];
  if (!argv0) return;
  if (!hasManagedCache(ctx, shell)) return;

  spawnBackgroundRefresh(argv0, shell);
}
