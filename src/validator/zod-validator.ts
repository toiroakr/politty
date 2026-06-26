import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { z } from "zod";
import type { ArgsSchema } from "../types.js";
import type { ValidationError, ValidationResult } from "./types.js";

// Re-exported for backwards compatibility; the canonical definitions are
// vendor-neutral and live in ./types.js.
export { formatValidationErrors } from "./types.js";
export type { ValidationError, ValidationResult } from "./types.js";

/** Minimal Zod-like surface used to invoke `safeParse` without coupling. */
interface ZodLike {
  safeParse(
    value: unknown,
  ): { success: true; data: unknown } | { success: false; error: z.ZodError };
}

/**
 * Convert ZodError to ValidationError array (zod v4 compatible)
 */
function formatZodErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
    received: "received" in issue ? issue.received : undefined,
    expected: "expected" in issue ? String(issue.expected) : undefined,
  }));
}

/**
 * Validate raw arguments against a schema
 *
 * @param rawArgs - Parsed but unvalidated arguments
 * @param schema - Zod schema (ZodObject, ZodDiscriminatedUnion, etc.)
 * @returns Validation result with typed data or errors
 */
export function validateArgs<T extends ArgsSchema>(
  rawArgs: Record<string, unknown>,
  schema: T,
): ValidationResult<StandardSchemaV1.InferOutput<T>> {
  const result = (schema as unknown as ZodLike).safeParse(rawArgs);

  if (result.success) {
    return {
      success: true,
      data: result.data as StandardSchemaV1.InferOutput<T>,
    };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
  };
}
