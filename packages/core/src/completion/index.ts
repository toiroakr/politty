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

import { defineCommand } from "../core/command.js";
import type { AnyCommand, ArgsSchema, Command } from "../types.js";
import { generateBashCompletion } from "./bash.js";
import { resolveBundledWorkerPath } from "./bundled-worker.js";
import { detectShell } from "./detect-shell.js";
import { generateDispatcherCompletion } from "./dispatcher.js";
import { createDynamicCompleteCommand } from "./dynamic/index.js";
import { generateFishCompletion } from "./fish.js";
import { install as installCompletion, refreshIfStale } from "./install.js";
import { generateLoader } from "./loader.js";
import {
  completionArgsSchema,
  refreshArgsSchema,
  workerPathArgsSchema,
  type CompletionArgs,
  type RefreshArgs,
  type WorkerPathArgs,
} from "./schemas.js";
import { shSingleQuote } from "./shell-shared.js";
import type {
  BundledWorkerOptions,
  CompletionOptions,
  CompletionResult,
  ShellType,
} from "./types.js";
import { generateZshCompletion } from "./zsh.js";

// Re-export dynamic completion types (in-process resolver)
export type {
  CompletionDirectiveMask,
  DynamicCompletionCandidate,
  DynamicCompletionContext,
  DynamicCompletionResolver,
  DynamicCompletionResult,
} from "../core/dynamic-completion-types.js";
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
// Re-export bundled worker helpers
export {
  bundledWorkerShellExtension,
  defaultBundledWorkerOutputPath,
  generateBundledCompletionWorker,
  validateBundledWorkerFile,
  type GenerateBundledCompletionWorkerOptions,
  type GenerateBundledCompletionWorkerResult,
} from "./bundled-worker.js";
// Re-export types
export type {
  BundledWorkerOptions,
  CompletableOption,
  CompletableSubcommand,
  CompletionData,
  CompletionGenerator,
  CompletionMode,
  CompletionOptions,
  CompletionResult,
  ShellType,
} from "./types.js";
// Re-export value completion resolver
export { resolveValueCompletion, type ValueCompletionField } from "./value-completion-resolver.js";
// Re-export shell detection (moved to detect-shell.ts, see import above)
export { detectShell } from "./detect-shell.js";
// Re-export withCompletionCommand (moved to with-completion-command.ts so the
// package entry point can import it without pulling in this whole module)
export { withCompletionCommand, type WithCompletionOptions } from "./with-completion-command.js";

/**
 * Generate completion script for the specified shell
 */
export function generateCompletion(
  command: AnyCommand,
  options: CompletionOptions,
): CompletionResult {
  // The direct API defaults to the self-contained static script: dispatcher
  // mode needs the runtime `__complete`/`__refresh-completion` commands, which
  // only `withCompletionCommand`/`createCompletionCommand` register, so a raw
  // `generateCompletion(command, { shell })` must not silently emit an unwired
  // dispatcher. The `completion <shell>` subcommand opts into dispatcher
  // explicitly (`mode: "dispatcher"`).
  if (options.mode === "dispatcher") {
    return generateDispatcherCompletion(command, options);
  }

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

function printZshFpathSetup(programName: string, target: string): void {
  console.error("");
  console.error("Configure zsh fpath with:");
  console.error("");
  console.error("    mkdir -p ~/.zsh/completions");
  console.error(`    ln -sf ${shSingleQuote(target)} ~/.zsh/completions/_${programName}`);
  console.error("");
  console.error("Add only this block to your ~/.zshrc before compinit:");
  console.error("");
  console.error("    fpath=(~/.zsh/completions $fpath)");
  console.error("    autoload -Uz compinit && compinit");
}

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
  extra: { cacheDir?: string; programVersion?: string; bundledWorker?: BundledWorkerOptions } = {},
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
    bundledWorker?: BundledWorkerOptions;
  } = {
    ...(cacheDir !== undefined && { cacheDir }),
    ...(programVersion !== undefined && { programVersion }),
    ...(globalArgsSchema !== undefined && { globalArgsSchema }),
    ...(extra.bundledWorker !== undefined && { bundledWorker: extra.bundledWorker }),
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
      __complete: createDynamicCompleteCommand(rootCommand, resolvedProgramName, globalArgsSchema),
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
  if (!rootCommand.subCommands?.["__completion-worker-path"]) {
    rootCommand.subCommands = {
      ...rootCommand.subCommands,
      "__completion-worker-path": createCompletionWorkerPathCommand(
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

      if (args.static && args.dispatcher) {
        throw new Error("Choose only one completion mode: --dispatcher or --static.");
      }
      if (args.worker && !args.static) {
        throw new Error("`--worker` requires `--static`.");
      }
      if (args.worker && (args.install || args.loader || args.instructions)) {
        throw new Error("`--worker` can only print a worker artifact.");
      }

      const completionMode = args.static ? "static" : "dispatcher";

      if (args.install) {
        let target: string;
        try {
          target = installCompletion({ rootCommand, ...installCtxBase, completionMode }, shellType);
        } catch (e) {
          throw new Error(`install failed: ${e instanceof Error ? e.message : String(e)}`);
        }
        console.error(`installed: ${target}`);
        if (shellType === "bash") {
          console.error("");
          console.error(`Add to your ~/.${shellType}rc:`);
          console.error("");
          console.error(
            generateLoader({ ...loaderOptsBase, shell: shellType })
              .trim()
              .replace(/^/gm, "    "),
          );
        } else if (shellType === "zsh") {
          printZshFpathSetup(resolvedProgramName, target);
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
        mode: completionMode,
        includeDescriptions: true,
        ...(globalArgsSchema !== undefined && { globalArgsSchema }),
        ...(programVersion !== undefined && { programVersion }),
        ...(cacheDir !== undefined && { cacheDir }),
        ...(extra.bundledWorker !== undefined && { bundledWorker: extra.bundledWorker }),
        ...(args.worker && { staticWorker: { functionSuffix: "worker" } }),
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
  extra: {
    cacheDir?: string;
    programVersion?: string;
    globalArgsSchema?: ArgsSchema;
    bundledWorker?: BundledWorkerOptions;
  } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof refreshArgsSchema, RefreshArgs, any> {
  return defineCommand({
    name: "__refresh-completion",
    description: "(internal) Refresh the on-disk completion cache if stale.",
    args: refreshArgsSchema,
    run(args) {
      refreshIfStale(
        {
          rootCommand,
          programName,
          ...extra,
          completionMode: args.static || args.worker ? "static" : undefined,
          ...(args.worker && { staticWorker: { functionSuffix: "worker" } }),
          ...(args.worker && { allowTargetCreate: true }),
          ...(args.target !== undefined && { targetPath: args.target }),
        },
        args.shell,
      );
    },
  });
}

export function createCompletionWorkerPathCommand(
  programName: string,
  extra: { binPath?: string; bundledWorker?: BundledWorkerOptions } = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof workerPathArgsSchema, WorkerPathArgs, any> {
  return defineCommand({
    name: "__completion-worker-path",
    description: "(internal) Print the bundled completion worker path when available.",
    args: workerPathArgsSchema,
    run(args) {
      const path = resolveBundledWorkerPath({
        programName,
        shell: args.shell,
        ...(extra.binPath !== undefined && { binPath: extra.binPath }),
        ...(extra.bundledWorker !== undefined && { bundledWorker: extra.bundledWorker }),
      });
      if (!path) {
        // Throw so runMain reports a non-zero exit code: a bare
        // `process.exitCode = 1` is overwritten by runMain's final
        // `process.exit(0)`, leaving build scripts unable to detect the miss.
        throw new Error(`No bundled completion worker found for ${programName} (${args.shell}).`);
      }
      console.log(path);
    },
  });
}
