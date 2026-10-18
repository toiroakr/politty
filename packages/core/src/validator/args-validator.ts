/**
 * Args validation facade.
 *
 * Routes raw parsed args to the implementation that understands the
 * command's schema: politty's internal validator-free descriptors, or the
 * registered validator adapter for user schemas. Neutral error shapes live
 * in `adapter/types.ts`; the schema-library-specific validation lives in
 * the adapter package (e.g. `@politty/zod`).
 */

import { isInternalArgsSchema, validateInternalArgs } from "../adapter/internal-args.js";
import { allFields, nestArgs } from "../adapter/nested-fields.js";
import { getValidatorAdapter } from "../adapter/registry.js";
import type { InferSchemaOutput } from "../adapter/standard-schema.js";
import type { ValidationError, ValidationResult } from "../adapter/types.js";
import {
  extractFields,
  selectDiscriminatedVariant,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "../core/schema-extractor.js";
import type { ArgsSchema } from "../types.js";

export type { ValidationError, ValidationResult } from "../adapter/types.js";

/**
 * Validate raw arguments against a schema
 *
 * @param rawArgs - Parsed but unvalidated arguments, keyed by field name
 * @param schema - Args schema (ZodObject, ZodDiscriminatedUnion, internal descriptor, etc.)
 * @returns Validation result with typed data or errors
 */
export function validateArgs<T extends ArgsSchema>(
  rawArgs: Record<string, unknown>,
  schema: T,
): ValidationResult<InferSchemaOutput<T>> {
  if (isInternalArgsSchema(schema)) {
    return validateInternalArgs(rawArgs, schema) as ValidationResult<InferSchemaOutput<T>>;
  }
  // Values of expanded object properties are parsed under flat names;
  // validate them at their property path.
  const extracted = extractFields(schema);
  const fields = allFields(extracted);
  const args = fields.some((field) => field.nested)
    ? nestArgs(rawArgs, fields, requiredObjectFields(rawArgs, extracted))
    : rawArgs;
  return getValidatorAdapter().validate(args, schema) as ValidationResult<InferSchemaOutput<T>>;
}

/**
 * The fields whose required objects are created even when none of their
 * properties is given: those of an object schema, or of the
 * discriminated-union variant the args select. A plain union cannot tell
 * which option's objects to create.
 */
function requiredObjectFields(
  rawArgs: Record<string, unknown>,
  extracted: ExtractedFields,
): ResolvedFieldMeta[] {
  const { discriminator } = extracted;
  if (discriminator) {
    // A discriminator left out selects the variant it defaults to.
    const selected = selectDiscriminatedVariant(extracted, ({ fields }) => {
      const defaultValue = fields.find((field) => field.name === discriminator)?.defaultValue;
      return rawArgs[discriminator] === undefined && defaultValue !== undefined
        ? { ...rawArgs, [discriminator]: defaultValue }
        : rawArgs;
    });
    return selected === extracted ? [] : selected.fields;
  }
  return extracted.variants || extracted.unionOptions ? [] : extracted.fields;
}

/**
 * Format validation errors for display
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
      return `${path}${e.message}`;
    })
    .join("\n");
}
