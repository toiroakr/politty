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

import { arg } from "../../core/arg-registry.js";
import { defineCommand } from "../../core/command.js";
import { s, type InferInternal } from "../../core/internal-schema.js";
import type { AnyCommand, ArgsSchema, Command } from "../../types.js";
import { detectInlineOptionPrefix, generateCandidates } from "./candidate-generator.js";
import { parseCompletionContext } from "./context-parser.js";
import { formatForShell } from "./shell-formatter.js";

/**
 * Schema for the __complete command
 */
const completeArgsSchema = s.object({
  shell: arg(s.enum(["bash", "zsh", "fish"]), {
    description: "Target shell for output formatting",
  }),
  // The arguments to complete are passed after --
  args: arg(s.array(s.string()).default([]), {
    positional: true,
    description: "Arguments to complete",
    variadic: true,
  }),
});

type CompleteArgs = InferInternal<typeof completeArgsSchema>;

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
      const context = parseCompletionContext(args.args, rootCommand, globalArgsSchema);

      // Detect the inline `--opt=` prefix so the formatter can re-attach
      // it to bash candidates. `generateCandidates` performs the same
      // strip internally so resolvers see only the value portion;
      // positionals (e.g. `cli -- --foo=<TAB>`) keep the prefix as part
      // of the value and bypass this detection.
      const inlinePrefix =
        context.completionType === "option-value" && context.targetOption
          ? detectInlineOptionPrefix(context.currentWord)
          : undefined;
      const effectiveWord = inlinePrefix
        ? context.currentWord.slice(inlinePrefix.length)
        : context.currentWord;

      const result = await generateCandidates(context, { shell: args.shell });

      const output = formatForShell(result, {
        shell: args.shell,
        currentWord: effectiveWord,
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
