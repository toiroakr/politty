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
 * @param isGiven - Whether a field got a value from the CLI or the environment
 */
export async function runEffects(
  validatedArgs: Record<string, unknown>,
  extracted: ExtractedFields,
  globalArgs?: Record<string, unknown>,
  isGiven: (name: string) => boolean = () => false,
): Promise<void> {
  for (const field of extracted.fields) {
    if (!field.effect) continue;
    // A leaf of an object that was left out, or that a transform turned
    // into something else, has no value of its own type.
    if (field.nested) {
      const object = getFieldValue(validatedArgs, objectOf(field));
      if (typeof object !== "object" || object === null) continue;
      if (!(field.nested.path.at(-1)! in object) && expectsValue(field, isGiven)) continue;
    }
    await field.effect(getFieldValue(validatedArgs, field), {
      name: field.name,
      args: validatedArgs,
      ...(globalArgs != null && { globalArgs }),
    });
  }
}

/**
 * Whether validation keeps a leaf's key in its object unless a transform
 * reshapes the object: the leaf is required, defaulted or was given. An
 * optional leaf that was left out has no key and still runs its effect.
 */
function expectsValue(field: ResolvedFieldMeta, isGiven: (name: string) => boolean): boolean {
  return field.required || field.defaultValue !== undefined || isGiven(field.name);
}

/** The object field enclosing a nested leaf, for reading its value */
function objectOf(field: ResolvedFieldMeta): ResolvedFieldMeta {
  return { ...field, nested: { path: field.nested!.path.slice(0, -1) } };
}
