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
import { nestingCandidates } from "../adapter/nested-fields.js";
import { getValidatorAdapter } from "../adapter/registry.js";
import type { InferSchemaOutput } from "../adapter/standard-schema.js";
import type { ValidationError, ValidationResult } from "../adapter/types.js";
import { extractFields } from "../core/schema-extractor.js";
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
  // Leaves of nested object fields are parsed under flat names; validate
  // them at their property path, as nested by the first branch that fits.
  const adapter = getValidatorAdapter();
  let result: ValidationResult<unknown> | undefined;
  for (const args of nestingCandidates(rawArgs, extractFields(schema))) {
    result = adapter.validate(args, schema);
    if (result.success) break;
  }
  return result as ValidationResult<InferSchemaOutput<T>>;
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
