/**
 * Dynamic completion command implementation
 *
 * This creates a hidden `__complete` command that outputs completion candidates
 * for shell scripts to consume. Usage:
 *
 *   mycli __complete -- build --fo
 *   mycli __complete -- plugin add
 *
 * Output format:
 *   value\tdescription
 *   ...
 *   :directive_code
 */

import { z } from "zod";
import { arg } from "../../core/arg-registry.js";
import { defineCommand } from "../../core/command.js";
import type { AnyCommand, Command } from "../../types.js";
import { formatOutput, generateCandidates } from "./candidate-generator.js";
import { parseCompletionContext } from "./context-parser.js";

/**
 * Schema for the __complete command
 *
 * Arguments after -- are collected as the completion arguments
 */
const completeArgsSchema = z.object({
  // The arguments to complete are passed after --
  // We use rest args to capture them
  args: arg(z.array(z.string()).default([]), {
    positional: true,
    description: "Arguments to complete",
    variadic: true,
  }),
});

type CompleteArgs = z.infer<typeof completeArgsSchema>;

/**
 * Create the dynamic completion command
 *
 * @param rootCommand - The root command to generate completions for
 * @param programName - The program name (optional, defaults to rootCommand.name)
 * @returns A command that outputs completion candidates
 */
export function createDynamicCompleteCommand(
  rootCommand: AnyCommand,
  _programName?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof completeArgsSchema, CompleteArgs, any> {
  return defineCommand({
    name: "__complete",
    // No description - this is a hidden command
    args: completeArgsSchema,
    run(args) {
      // Parse the completion context
      const context = parseCompletionContext(args.args, rootCommand);

      // Generate candidates
      const result = generateCandidates(context);

      // Output in shell-consumable format
      console.log(formatOutput(result));
    },
  });
}

/**
 * Check if a command tree contains the __complete command
 */
export function hasCompleteCommand(command: AnyCommand): boolean {
  return Boolean(command.subCommands?.["__complete"]);
}
