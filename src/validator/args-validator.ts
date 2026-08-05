/**
 * Args validation facade.
 *
 * Routes raw parsed args to the implementation that understands the
 * command's schema: politty's internal validator-free descriptors, or the
 * zod adapter for user schemas. Neutral error shapes live in
 * `adapter/types.ts`; zod-specific validation lives in `zod/adapter.ts`.
 */

import type { z } from "zod";
import { isInternalArgsSchema, validateInternalArgs } from "../adapter/internal-args.js";
import type { ValidationError, ValidationResult } from "../adapter/types.js";
import type { ArgsSchema } from "../types.js";
import { zodAdapter } from "../zod/adapter.js";

export type { ValidationError, ValidationResult } from "../adapter/types.js";

/**
 * Validate raw arguments against a schema
 *
 * @param rawArgs - Parsed but unvalidated arguments
 * @param schema - Args schema (ZodObject, ZodDiscriminatedUnion, internal descriptor, etc.)
 * @returns Validation result with typed data or errors
 */
export function validateArgs<T extends ArgsSchema>(
  rawArgs: Record<string, unknown>,
  schema: T,
): ValidationResult<z.infer<T>> {
  if (isInternalArgsSchema(schema)) {
    return validateInternalArgs(rawArgs, schema) as ValidationResult<z.infer<T>>;
  }
  return zodAdapter.validate(rawArgs, schema) as ValidationResult<z.infer<T>>;
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
