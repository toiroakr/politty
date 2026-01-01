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
 * const mainCommand = defineCommand({
 *   name: "mycli",
 *   subCommands: {
 *     completion: createCompletionCommand(myCommand, "mycli")
 *   }
 * });
 * ```
 */

import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import type { AnyCommand, Command } from "../types.js";
import { generateBashCompletion } from "./bash.js";
import { generateFishCompletion } from "./fish.js";
import type { CompletionOptions, CompletionResult, ShellType } from "./types.js";
import { generateZshCompletion } from "./zsh.js";

// Re-export types
// Re-export extractor
export { extractCompletionData, extractPositionals } from "./extractor.js";
export type {
    CompletableOption,
    CompletableSubcommand,
    CompletionData,
    CompletionGenerator,
    CompletionOptions,
    CompletionResult,
    ShellType
} from "./types.js";


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
 *     completion: createCompletionCommand(mainCommand, "mycli")
 *   }
 * });
 * ```
 */
export function createCompletionCommand(
  rootCommand: AnyCommand,
  programName: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof completionArgsSchema, CompletionArgs, any> {
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
        programName,
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
 * Helper to add completion command to an existing command's subCommands
 *
 * @example
 * ```typescript
 * const command = defineCommand({
 *   name: "mycli",
 *   subCommands: {
 *     ...withCompletionCommand(command, "mycli"),
 *     // other subcommands
 *   }
 * });
 * ```
 */
export function withCompletionCommand(
  rootCommand: AnyCommand,
  programName: string,
): { completion: ReturnType<typeof createCompletionCommand> } {
  return {
    completion: createCompletionCommand(rootCommand, programName),
  };
}
