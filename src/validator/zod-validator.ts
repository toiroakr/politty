import { z } from "zod";
import type { ArgsSchema } from "../types.js";

/**
 * Validation error details
 */
export interface ValidationError {
  /** Path to the invalid field */
  path: string[];
  /** Error message */
  message: string;
  /** Zod error code */
  code: string;
  /** Value that was received */
  received?: unknown | undefined;
  /** Expected type or value */
  expected?: string | undefined;
}

/**
 * Validation result
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };

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
): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(rawArgs);

  if (result.success) {
    return {
      success: true,
      data: result.data as z.infer<T>,
    };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
  };
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
