import type { ResolvedFieldMeta } from "../adapter/field-meta.js";
import { getFieldValue } from "../adapter/nested-fields.js";
import type { ExtractedFields } from "./schema-extractor.js";

/**
 * Execute all registered effect callbacks for validated args.
 *
 * Effects run sequentially in field-definition order.
 * Only fires for fields that have an `effect` callback defined.
 *
 * @param validatedArgs - The validated (post-Zod) argument values
 * @param extracted - The extracted fields from the schema
 * @param globalArgs - The validated global args (passed to command arg effects)
 */
export async function runEffects(
  validatedArgs: Record<string, unknown>,
  extracted: ExtractedFields,
  globalArgs?: Record<string, unknown>,
): Promise<void> {
  for (const field of extracted.fields) {
    if (!field.effect) continue;
    // A leaf of an object that was left out, or that a transform turned
    // into something else, has no value of its own type.
    if (field.nested) {
      const object = getFieldValue(validatedArgs, objectOf(field));
      if (typeof object !== "object" || object === null) continue;
    }
    await field.effect(getFieldValue(validatedArgs, field), {
      name: field.name,
      args: validatedArgs,
      ...(globalArgs != null && { globalArgs }),
    });
  }
}

/** The object field enclosing a nested leaf, for reading its value */
function objectOf(field: ResolvedFieldMeta): ResolvedFieldMeta {
  return { ...field, nested: { path: field.nested!.path.slice(0, -1) } };
}
