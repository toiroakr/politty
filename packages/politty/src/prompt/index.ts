import type { ExtractedFields, ResolvedFieldMeta } from "../core/schema-extractor.js";
import { getFieldsToPrompt, resolvePromptConfig } from "./prompt-resolver.js";
import { isInteractive } from "./tty-detector.js";
import type { PromptAdapter, ResolvedPromptConfig } from "./types.js";

export { getFieldsToPrompt, resolvePromptConfig } from "./prompt-resolver.js";
export { isInteractive } from "./tty-detector.js";
export type { PromptAdapter, ResolvedPromptConfig } from "./types.js";

/**
 * Options for promptMissingArgs behavior
 */
export interface PromptOptions {
  /** Prompt adapter to use for rendering prompts */
  adapter: PromptAdapter;
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
  options: PromptOptions,
): Promise<Record<string, unknown>> {
  const interactive = options.interactive ?? isInteractive();
  if (!interactive) return rawArgs;

  const adapter = options.adapter;
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
    // For object and intersection schemas, prompt all fields as a flat list.
    // Limitation: intersection schemas that compose a discriminatedUnion
    // (e.g. sharedOptions.and(z.discriminatedUnion(...))) lose variant
    // structure here because extractFields flattens both operands. Variant-
    // aware prompting for intersections requires architectural changes to
    // preserve sub-schema structure through extraction.
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
  // The deduplicated extracted.fields only keeps the first variant's
  // discriminator, so scan all variants for prompt metadata and build
  // choices from every variant's discriminator value.
  if (result[discriminator] === undefined) {
    const discField = findDiscriminatorField(extracted.fields, variants, discriminator);
    const discConfig = discField ? resolvePromptConfig(discField) : null;
    if (discConfig) {
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

/**
 * Find the discriminator field with prompt metadata, checking the
 * deduplicated top-level fields first, then scanning per-variant fields.
 */
function findDiscriminatorField(
  fields: ResolvedFieldMeta[],
  variants: NonNullable<ExtractedFields["variants"]>,
  discriminator: string,
): ResolvedFieldMeta | undefined {
  const topLevel = fields.find((f) => f.name === discriminator);
  if (topLevel?.prompt) return topLevel;
  for (const variant of variants) {
    const field = variant.fields.find((f) => f.name === discriminator);
    if (field?.prompt) return field;
  }
  return undefined;
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
  const { message } = config;
  let value: unknown;
  switch (config.type) {
    case "text":
      value = await adapter.text({ message, placeholder: config.field.placeholder });
      break;
    case "password":
      value = await adapter.password({ message });
      break;
    case "confirm":
      value = await adapter.confirm({ message });
      break;
    case "select":
      value = await adapter.select({ message, options: config.choices ?? [] });
      break;
  }
  if (adapter.isCancelled(value)) {
    throw new Error("Prompt cancelled by user");
  }
  result[config.field.name] = value;
}
