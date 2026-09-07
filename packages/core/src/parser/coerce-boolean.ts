/**
 * Coerce a string to a boolean for boolean-typed fields, using the same
 * literal set as Go's `strconv.ParseBool` (the de facto convention followed
 * by Docker, kubectl, Terraform, and GitHub Actions' `RUNNER_DEBUG`).
 * Values outside this set are passed through unchanged so downstream
 * validation reports the invalid input instead of silently guessing.
 */
const TRUE_VALUES = new Set(["1", "t", "T", "TRUE", "true", "True"]);
const FALSE_VALUES = new Set(["0", "f", "F", "FALSE", "false", "False"]);

export function coerceBoolean(value: string): unknown {
  if (TRUE_VALUES.has(value)) return true;
  if (FALSE_VALUES.has(value)) return false;
  return value;
}

/**
 * Apply `coerceBoolean` only when the field is typed as boolean; other
 * field types (e.g. numbers relying on `z.coerce.number()`) keep the raw
 * env string unchanged.
 */
export function coerceEnvValue(
  value: string,
  fieldType: "string" | "number" | "boolean" | "array" | "unknown",
): unknown {
  return fieldType === "boolean" ? coerceBoolean(value) : value;
}
