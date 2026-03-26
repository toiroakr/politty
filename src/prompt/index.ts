import type { ExtractedFields } from "../core/schema-extractor.js";
import type { MainOptions, RunCommandOptions } from "../types.js";
import { createClackAdapter } from "./clack-adapter.js";
import { getFieldsToPrompt } from "./prompt-resolver.js";
import { isInteractive } from "./tty-detector.js";
import type { PromptAdapter } from "./types.js";

export { getFieldsToPrompt, resolvePromptConfig } from "./prompt-resolver.js";
export { isInteractive } from "./tty-detector.js";
export type { PromptAdapter, ResolvedPromptConfig } from "./types.js";

/**
 * Options for prompt behavior
 */
export interface WithPromptOptions {
  /** Custom prompt adapter (defaults to @clack/prompts) */
  adapter?: PromptAdapter;
  /** Override interactive detection (force enable/disable prompts) */
  interactive?: boolean;
}

/**
 * Prompt for missing argument values interactively.
 *
 * Only prompts for fields that have `prompt` metadata set via `arg()` and
 * whose values are still undefined after CLI and env resolution.
 * Returns rawArgs unchanged in non-interactive environments.
 */
export async function promptMissingArgs(
  rawArgs: Record<string, unknown>,
  extracted: ExtractedFields,
  options?: WithPromptOptions,
): Promise<Record<string, unknown>> {
  const interactive = options?.interactive ?? isInteractive();
  if (!interactive) return rawArgs;

  const fieldsToPrompt = getFieldsToPrompt(extracted.fields, rawArgs);
  if (fieldsToPrompt.length === 0) return rawArgs;

  const adapter = options?.adapter ?? createClackAdapter();
  const result = { ...rawArgs };

  for (const config of fieldsToPrompt) {
    let value: unknown;
    switch (config.type) {
      case "text": {
        const textOpts: Parameters<PromptAdapter["text"]>[0] = {
          message: config.message,
        };
        if (config.field.placeholder !== undefined) {
          textOpts.placeholder = config.field.placeholder;
        }
        value = await adapter.text(textOpts);
        break;
      }
      case "password":
        value = await adapter.password({ message: config.message });
        break;
      case "confirm":
        value = await adapter.confirm({ message: config.message });
        break;
      case "select":
        value = await adapter.select({
          message: config.message,
          options: config.choices ?? [],
        });
        break;
    }

    if (adapter.isCancelled(value)) {
      throw new Error("Prompt cancelled by user");
    }

    result[config.field.name] = value;
  }

  return result;
}

/**
 * Create a resolvePrompts callback for use with MainOptions/RunCommandOptions.
 */
export function createPromptResolver(
  options?: WithPromptOptions,
): (
  rawArgs: Record<string, unknown>,
  extracted: ExtractedFields,
) => Promise<Record<string, unknown>> {
  return (rawArgs, extracted) => promptMissingArgs(rawArgs, extracted, options);
}

/**
 * Enhance MainOptions or RunCommandOptions with interactive prompting.
 *
 * @example
 * ```ts
 * import { runMain, defineCommand } from "politty";
 * import { withPrompt } from "politty/prompt";
 *
 * const cmd = defineCommand({
 *   name: "greet",
 *   args: z.object({
 *     name: arg(z.string(), {
 *       description: "Your name",
 *       prompt: { message: "What is your name?" },
 *     }),
 *   }),
 *   run: ({ name }) => console.log(`Hello, ${name}!`),
 * });
 *
 * runMain(cmd, withPrompt({ version: "1.0.0" }));
 * ```
 */
export function withPrompt<T extends MainOptions | RunCommandOptions>(
  options: T,
  promptOptions?: WithPromptOptions,
): T {
  return {
    ...options,
    resolvePrompts: createPromptResolver(promptOptions),
  };
}
