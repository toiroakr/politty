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
import type { AnyCommand, Command } from "../types.js";
import { generateBashCompletion } from "./bash.js";
import { createDynamicCompleteCommand } from "./dynamic/index.js";
import { generateFishCompletion } from "./fish.js";
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
});

type CompletionArgs = z.infer<typeof completionArgsSchema>;

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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof completionArgsSchema, CompletionArgs, any> {
  const resolvedProgramName = programName ?? rootCommand.name;

  if (!rootCommand.subCommands?.__complete) {
    rootCommand.subCommands = {
      ...rootCommand.subCommands,
      __complete: createDynamicCompleteCommand(rootCommand, resolvedProgramName),
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

      const result = generateCompletion(rootCommand, {
        shell: shellType,
        programName: resolvedProgramName,
        includeDescriptions: true,
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
 * Options for withCompletionCommand
 */
export interface WithCompletionOptions {
  /** Override the program name (defaults to command.name) */
  programName?: string;
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

  const { programName } = opts;

  const wrappedCommand = {
    ...command,
  } as T;

  wrappedCommand.subCommands = {
    ...command.subCommands,
    completion: createCompletionCommand(wrappedCommand, programName),
    __complete: createDynamicCompleteCommand(wrappedCommand, programName),
  };

  return wrappedCommand;
}
