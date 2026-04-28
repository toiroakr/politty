/**
 * Dynamic completion command implementation
 *
 * This creates a hidden `__complete` command that outputs completion candidates
 * for shell scripts to consume. Usage:
 *
 *   mycli __complete --shell bash -- build --fo
 *   mycli __complete --shell zsh -- plugin add
 *
 * Output format depends on the target shell:
 *   bash: plain values (pre-filtered by prefix), last line :directive
 *   zsh:  value:description pairs, last line :directive
 *   fish: value\tdescription pairs, last line :directive
 */

import { z } from "zod";
import { arg } from "../../core/arg-registry.js";
import { defineCommand } from "../../core/command.js";
import type { AnyCommand, ArgsSchema, Command } from "../../types.js";
import { generateCandidates } from "./candidate-generator.js";
import { parseCompletionContext } from "./context-parser.js";
import { formatForShell } from "./shell-formatter.js";

/**
 * Detect inline option-value prefix (e.g., "--format=" from "--format=json")
 */
function detectInlinePrefix(currentWord: string): string | undefined {
  if (currentWord.startsWith("--") && currentWord.includes("=")) {
    return currentWord.slice(0, currentWord.indexOf("=") + 1);
  }
  return undefined;
}

/**
 * Schema for the __complete command
 */
const completeArgsSchema = z.object({
  shell: arg(z.enum(["bash", "zsh", "fish"]), {
    description: "Target shell for output formatting",
  }),
  // The arguments to complete are passed after --
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
 * @param globalArgsSchema - Global args schema. Forwarded to
 *   `parseCompletionContext` so resolvers attached to global options remain
 *   reachable at every subcommand level.
 * @returns A command that outputs completion candidates
 */
export function createDynamicCompleteCommand(
  rootCommand: AnyCommand,
  _programName?: string,
  globalArgsSchema?: ArgsSchema,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Command<typeof completeArgsSchema, CompleteArgs, any> {
  return defineCommand({
    name: "__complete",
    // No description - this is a hidden command
    args: completeArgsSchema,
    async run(args) {
      // Parse the completion context
      const context = parseCompletionContext(args.args, rootCommand, globalArgsSchema);

      // Detect bash inline option-value prefix
      const inlinePrefix = detectInlinePrefix(context.currentWord);

      // Generate candidates (shellCommand/file extensions resolved in JS,
      // dynamic resolvers awaited). When an inline prefix is present, hand
      // the resolver only the value after `=` so it does not have to peel
      // the prefix off itself.
      const generationContext = inlinePrefix
        ? { ...context, currentWord: context.currentWord.slice(inlinePrefix.length) }
        : context;
      const result = await generateCandidates(generationContext, { shell: args.shell });

      // Format for the target shell
      const output = formatForShell(result, {
        shell: args.shell,
        currentWord: inlinePrefix
          ? context.currentWord.slice(inlinePrefix.length)
          : context.currentWord,
        inlinePrefix,
      });

      console.log(output);
    },
  });
}

/**
 * Check if a command tree contains the __complete command
 */
export function hasCompleteCommand(command: AnyCommand): boolean {
  return Boolean(command.subCommands?.["__complete"]);
}
