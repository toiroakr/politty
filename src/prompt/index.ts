import type { ExtractedFields, ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { MainOptions, RunCommandOptions } from "../types.js";
import { createClackAdapter } from "./clack-adapter.js";
import { getFieldsToPrompt } from "./prompt-resolver.js";
import { isInteractive } from "./tty-detector.js";
import type { PromptAdapter, ResolvedPromptConfig } from "./types.js";

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

  const adapter = options?.adapter ?? createClackAdapter();
  const result = { ...rawArgs };

  // For discriminatedUnion schemas, prompt the discriminator first then
  // narrow to the active variant to avoid prompting irrelevant fields.
  if (
    extracted.schemaType === "discriminatedUnion" &&
    extracted.discriminator &&
    extracted.variants
  ) {
    await promptDiscriminatedUnion(adapter, result, extracted);
  } else if (extracted.schemaType === "union" || extracted.schemaType === "xor") {
    // Plain unions have no discriminator to narrow by. Prompting the merged
    // field set would collect answers for incompatible branches, causing
    // silent data loss (strip mode) or validation errors (strict mode).
    // Skip prompting and let Zod validation handle it.
  } else {
    await promptAllFields(adapter, result, extracted.fields);
  }

  return result;
}

async function promptDiscriminatedUnion(
  adapter: PromptAdapter,
  result: Record<string, unknown>,
  extracted: ExtractedFields,
): Promise<void> {
  const { discriminator, variants } = extracted;
  if (!discriminator || !variants) return;

  // Prompt for discriminator if not already provided.
  // Build choices from all variants (the deduplicated extracted.fields only
  // keeps the first variant's discriminator, losing later values).
  if (result[discriminator] === undefined) {
    const discFields = getFieldsToPrompt(
      extracted.fields.filter((f) => f.name === discriminator),
      result,
    );
    if (discFields.length > 0) {
      const discConfig = { ...discFields[0]! };
      const allValues = variants.map((v) => v.discriminatorValue).filter(Boolean);
      if (allValues.length > 0) {
        discConfig.type = "select";
        discConfig.choices = allValues.map((v) => ({ label: v, value: v }));
      }
      await promptAndCollect(adapter, result, discConfig);
    }
  }

  // Find the active variant based on discriminator value
  const discValue = String(result[discriminator] ?? "");
  const activeVariant = variants.find((v) => v.discriminatorValue === discValue);

  if (activeVariant) {
    // Prompt only the active variant's fields (excluding discriminator)
    const variantFields = activeVariant.fields.filter((f) => f.name !== discriminator);
    await promptAllFields(adapter, result, variantFields);
  }
  // When no variant matches (invalid value or unextracted discriminator),
  // skip prompting and let Zod validation surface the error.
}

async function promptAllFields(
  adapter: PromptAdapter,
  result: Record<string, unknown>,
  fields: ResolvedFieldMeta[],
): Promise<void> {
  const fieldsToPrompt = getFieldsToPrompt(fields, result);
  for (const config of fieldsToPrompt) {
    await promptAndCollect(adapter, result, config);
  }
}

async function promptAndCollect(
  adapter: PromptAdapter,
  result: Record<string, unknown>,
  config: ResolvedPromptConfig,
): Promise<void> {
  const value = await promptField(adapter, config);
  if (adapter.isCancelled(value)) {
    throw new Error("Prompt cancelled by user");
  }
  result[config.field.name] = value;
}

async function promptField(adapter: PromptAdapter, config: ResolvedPromptConfig): Promise<unknown> {
  const { message } = config;
  switch (config.type) {
    case "text":
      return adapter.text({ message, placeholder: config.field.placeholder });
    case "password":
      return adapter.password({ message });
    case "confirm":
      return adapter.confirm({ message });
    case "select":
      return adapter.select({ message, options: config.choices ?? [] });
  }
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
 * Note: this replaces any existing `resolvePrompts` callback on the options
 * object. If you need to compose multiple resolvers, build a custom
 * `resolvePrompts` callback instead of using this helper.
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
): T & { resolvePrompts: ReturnType<typeof createPromptResolver> } {
  return {
    ...options,
    resolvePrompts: createPromptResolver(promptOptions),
  };
}
