/**
 * Shell completion generation module
 *
 * Provides utilities to generate shell completion scripts for bash, zsh, and fish.
 *
 * @example
 * ```typescript
 * import { generateCompletion, createCompletionCommand } from "politty/completion";
 *
 * // Generate completion script directly
 * const result = generateCompletion(myCommand, {
 *   shell: "bash",
 *   programName: "mycli"
 * });
 * console.log(result.script);
 *
 * // Or add a completion subcommand to your CLI
 * const mainCommand = withCompletionCommand(
 *   defineCommand({
 *     name: "mycli",
 *     subCommands: { ... },
 *   }),
 * );
 * ```
 */

import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import type { AnyCommand, ArgsSchema, Command } from "../types.js";
import { generateBashCompletion } from "./bash.js";
import { createDynamicCompleteCommand } from "./dynamic/index.js";
import { generateFishCompletion } from "./fish.js";
import {
  hasManagedCache,
  install as installCompletion,
  refreshIfStale,
  spawnBackgroundRefresh,
} from "./install.js";
import { generateLoader } from "./loader.js";
import type { CompletionOptions, CompletionResult, ShellType } from "./types.js";
import { generateZshCompletion } from "./zsh.js";

// Re-export dynamic completion
export {
  CompletionDirective,
  createDynamicCompleteCommand,
  formatForShell,
  generateCandidates,
  hasCompleteCommand,
  parseCompletionContext,
  type CandidateResult,
  type CompletionCandidate,
  type CompletionContext,
  type CompletionType,
  type ShellFormatOptions,
} from "./dynamic/index.js";
// Re-export extractor
export { extractCompletionData, extractPositionals } from "./extractor.js";
// Re-export types
export type {
  CompletableOption,
  CompletableSubcommand,
  CompletionData,
  CompletionGenerator,
  CompletionOptions,
  CompletionResult,
  ShellType,
} from "./types.js";
// Re-export value completion resolver
export { resolveValueCompletion, type ValueCompletionField } from "./value-completion-resolver.js";

/**
 * Generate completion script for the specified shell
 */
export function generateCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  switch (options.shell) {
    case "bash":
      return generateBashCompletion(command, options);
    case "zsh":
      return generateZshCompletion(command, options);
    case "fish":
      return generateFishCompletion(command, options);
    default:
      throw new Error(`Unsupported shell: ${options.shell}`);
  }
}

/**
 * Get the list of supported shells
 */
export function getSupportedShells(): ShellType[] {
  return ["bash", "zsh", "fish"];
}

/**
 * Detect the current shell from environment
 */
export function detectShell(): ShellType | null {
  const shell = process.env.SHELL || "";
  const shellName = shell.split("/").pop()?.toLowerCase() || "";

  if (shellName.includes("bash")) {
    return "bash";
  }
  if (shellName.includes("zsh")) {
    return "zsh";
  }
  if (shellName.includes("fish")) {
    return "fish";
  }

  return null;
}

/**
 * Schema for the completion command arguments
 */
const completionArgsSchema = z.object({
  shell: arg(
    z
      .enum(["bash", "zsh", "fish"])
      .optional()
      .describe("Shell type (auto-detected if not specified)"),
    {
      positional: true,
      description: "Shell type (bash, zsh, or fish)",
      placeholder: "SHELL",
    },
  ),
  instructions: arg(z.boolean().default(false), {
    alias: "i",
    description: "Show installation instructions",
  }),
  loader: arg(z.boolean().default(false), {
    description:
      "Print just the rc loader snippet (bash/zsh). Add it to ~/.bashrc or ~/.zshrc; it auto-regenerates the cache when the binary changes.",
  }),
  install: arg(z.boolean().default(false), {
    description:
      "Write the completion script to its on-disk cache (bash/zsh) or autoload location (fish) instead of printing it.",
  }),
});

type CompletionArgs = z.infer<typeof completionArgsSchema>;

const refreshArgsSchema = z.object({
  shell: arg(z.enum(["bash", "zsh", "fish"]), {
    positional: true,
    description: "Shell to refresh",
    placeholder: "SHELL",
  }),
});

type RefreshArgs = z.infer<typeof refreshArgsSchema>;

/**
 * Create a completion subcommand for your CLI
 *
 * This creates a ready-to-use subcommand that generates completion scripts.
 *
 * @example
 * ```typescript
 * const mainCommand = defineCommand({
 *   name: "mycli",
 *   subCommands: {
 *     completion: createCompletionCommand(mainCommand)
 *   }
 * });
 * ```
 */
export function createCompletionCommand(
  rootCommand: AnyCommand,
  programName?: string,
  globalArgsSchema?: ArgsSchema,
  extra: { cacheDir?: string; programVersion?: string } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof completionArgsSchema, CompletionArgs, any> {
  const resolvedProgramName = programName ?? rootCommand.name;
  const { cacheDir, programVersion } = extra;

  // Build the option fragments once. Under exactOptionalPropertyTypes
  // we can't pass `undefined` values directly, so we omit absent keys.
  const refreshExtra: {
    cacheDir?: string;
    programVersion?: string;
    globalArgsSchema?: ArgsSchema;
  } = {
    ...(cacheDir !== undefined && { cacheDir }),
    ...(programVersion !== undefined && { programVersion }),
    ...(globalArgsSchema !== undefined && { globalArgsSchema }),
  };
  const installCtxBase: Omit<Parameters<typeof installCompletion>[0], "rootCommand"> = {
    programName: resolvedProgramName,
    ...refreshExtra,
  };
  const loaderOptsBase = {
    programName: resolvedProgramName,
    ...(cacheDir !== undefined && { cacheDir }),
  };

  if (!rootCommand.subCommands?.__complete) {
    rootCommand.subCommands = {
      ...rootCommand.subCommands,
      __complete: createDynamicCompleteCommand(rootCommand, resolvedProgramName),
    };
  }
  // Register `__refresh-completion` here too so callers using
  // `createCompletionCommand` directly (rather than
  // `withCompletionCommand`) still expose the subcommand the generated
  // rc loaders / fish autoload expect to invoke after the binary's
  // mtime changes. Without it, the loaders would call an unknown
  // subcommand with stderr swallowed and silently keep sourcing the
  // stale cache.
  if (!rootCommand.subCommands?.["__refresh-completion"]) {
    rootCommand.subCommands = {
      ...rootCommand.subCommands,
      "__refresh-completion": createRefreshCompletionCommand(
        rootCommand,
        resolvedProgramName,
        refreshExtra,
      ),
    };
  }

  return defineCommand({
    name: "completion",
    description: "Generate shell completion script",
    args: completionArgsSchema,
    run(args) {
      // Detect shell if not specified
      const shellType = args.shell || detectShell();

      if (!shellType) {
        console.error("Could not detect shell type. Please specify one of: bash, zsh, fish");
        process.exitCode = 1;
        return;
      }

      if (args.install) {
        let target: string;
        try {
          target = installCompletion({ rootCommand, ...installCtxBase }, shellType);
        } catch (e) {
          throw new Error(`install failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        console.error(`installed: ${target}`);
        if (shellType !== "fish") {
          console.error("");
          console.error(`Add to your ~/.${shellType}rc:`);
          console.error("");
          console.error(
            generateLoader({ ...loaderOptsBase, shell: shellType })
              .trim()
              .replace(/^/gm, "    "),
          );
        }
        return;
      }

      if (args.loader) {
        if (shellType === "fish") {
          throw new Error(
            "fish does not use an rc loader. Run `<program> completion fish --install` to write the self-refreshing autoload file instead.",
          );
        }
        process.stdout.write(generateLoader({ ...loaderOptsBase, shell: shellType }));
        return;
      }

      const result = generateCompletion(rootCommand, {
        shell: shellType,
        programName: resolvedProgramName,
        includeDescriptions: true,
        ...(globalArgsSchema !== undefined && { globalArgsSchema }),
        ...(programVersion !== undefined && { programVersion }),
        ...(cacheDir !== undefined && { cacheDir }),
      });

      if (args.instructions) {
        console.log(result.installInstructions);
      } else {
        console.log(result.script);
      }
    },
  });
}

/**
 * Hidden subcommand that the runMain background hook spawns. It does
 * the same stat-compare + atomic rewrite as the rc loader, but in a
 * detached child process so it's invisible to the user.
 */
export function createRefreshCompletionCommand(
  rootCommand: AnyCommand,
  programName: string,
  extra: { cacheDir?: string; programVersion?: string; globalArgsSchema?: ArgsSchema } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof refreshArgsSchema, RefreshArgs, any> {
  return defineCommand({
    name: "__refresh-completion",
    description: "(internal) Refresh the on-disk completion cache if stale.",
    args: refreshArgsSchema,
    run(args) {
      refreshIfStale({ rootCommand, programName, ...extra }, args.shell);
    },
  });
}

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

  const { programName, globalArgsSchema, cacheDir, programVersion } = opts;
  const resolvedProgramName = programName ?? command.name;
  const extra: { cacheDir?: string; programVersion?: string; globalArgsSchema?: ArgsSchema } = {
    ...(cacheDir !== undefined && { cacheDir }),
    ...(programVersion !== undefined && { programVersion }),
    ...(globalArgsSchema !== undefined && { globalArgsSchema }),
  };

  const wrappedCommand = {
    ...command,
  } as T;

  wrappedCommand.subCommands = {
    ...command.subCommands,
    completion: createCompletionCommand(wrappedCommand, programName, globalArgsSchema, extra),
    // Note: __complete (dynamic completion) does not yet receive globalArgsSchema.
    // Static completion scripts (bash/zsh/fish) already include global options.
    __complete: createDynamicCompleteCommand(wrappedCommand, programName),
    "__refresh-completion": createRefreshCompletionCommand(
      wrappedCommand,
      resolvedProgramName,
      extra,
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
