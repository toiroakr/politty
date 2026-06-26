/**
 * Vendor-neutral validation result types, shared by every schema adapter
 * (Zod's `safeParse` path, the Standard Schema `~standard.validate` path, and
 * politty's internal schema). Kept free of any schema-library import so the
 * core and all adapters can depend on it without coupling to a vendor.
 */

/**
 * Validation error details
 */
export interface ValidationError {
  /** Path to the invalid field */
  path: string[];
  /** Error message */
  message: string;
  /** Error code (Zod code, or a best-effort code recovered from other libraries) */
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
 * Format validation errors for display (plain `path: message` lines).
 *
 * This is the minimal join used by callers that want a bare string; the styled,
 * user-facing renderer lives in `error-formatter.ts`.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors
    .map((e) => {
      const path = e.path.length > 0 ? `${e.path.join(".")}: ` : "";
      return `${path}${e.message}`;
    })
    .join("\n");
}
