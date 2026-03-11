import type { ExtractedFields } from "./schema-extractor.js";

/**
 * Execute all registered effect callbacks for validated args.
 *
 * Effects run sequentially in field-definition order.
 * Only fires for fields that have an `effect` callback defined.
 *
 * @param validatedArgs - The validated (post-Zod) argument values
 * @param extracted - The extracted fields from the schema
 */
export async function runEffects(
  validatedArgs: Record<string, unknown>,
  extracted: ExtractedFields,
): Promise<void> {
  for (const field of extracted.fields) {
    if (!field.effect) continue;
    await field.effect(validatedArgs[field.name], { name: field.name, args: validatedArgs });
  }
}
