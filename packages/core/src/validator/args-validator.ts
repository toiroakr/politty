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
  // Failures in order of preference: the whole schema rejecting a branch's
  // nesting, the branch itself rejecting it, then the diagnostic nesting.
  let reported: ValidationResult<unknown> | undefined;
  let branchFailure: ValidationResult<unknown> | undefined;
  let last: ValidationResult<unknown> | undefined;
  for (const candidate of nestingCandidates(rawArgs, extractFields(schema))) {
    let own: ValidationResult<unknown> | undefined;
    if (candidate.branchSchema) {
      own = adapter.validate(candidate.args, candidate.branchSchema);
      if (!own.success) {
        // Prefer the option that rejects the fewest given values: one that
        // only misses values says more than one the given values rule out.
        if (
          !onlyDefaulted(own, candidate.defaultedPaths) &&
          (!branchFailure ||
            issuesUnder(own, candidate.givenPaths) <
              issuesUnder(branchFailure, candidate.givenPaths))
        )
          branchFailure = own;
        continue;
      }
    }
    const result = adapter.validate(candidate.args, schema);
    if (result.success && own?.success) {
      // The whole union may have matched an earlier option that drops
      // values this branch keeps; never accept that silently.
      const dropped = (candidate.givenPaths ?? []).filter(
        (path) => valueAt(own.data, path) !== undefined && valueAt(result.data, path) === undefined,
      );
      if (dropped.length > 0) {
        const message = `${dropped.map((path) => path.join(".")).join(", ")} would be ignored: another schema option accepts the arguments without them.`;
        reported ??= { success: false, errors: [{ path: [], message, code: "invalid_union" }] };
        continue;
      }
    }
    if (result.success) {
      if (!candidate.diagnosticOnly) return result as ValidationResult<InferSchemaOutput<T>>;
      last = {
        success: false,
        errors: [{ path: [], message: candidate.diagnosticOnly.message, code: "invalid_union" }],
      };
      continue;
    }
    last = result;
    // Skip failures about values copied from an object default rather
    // than given.
    if (!candidate.diagnosticOnly && !onlyDefaulted(result, candidate.defaultedPaths))
      reported ??= result;
  }
  return (reported ?? branchFailure ?? last) as ValidationResult<InferSchemaOutput<T>>;
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

/**
 * How many issues of a failed validation lie under one of `paths`.
 */
function issuesUnder(
  result: ValidationResult<unknown>,
  paths: readonly string[][] | undefined,
): number {
  if (result.success || !paths?.length) return 0;
  return result.errors.filter((error) =>
    paths.some((path) => path.every((key, i) => error.path[i] === key)),
  ).length;
}

/**
 * Whether every issue of a failed validation lies under one of `paths`.
 */
function onlyDefaulted(
  result: ValidationResult<unknown>,
  paths: readonly string[][] | undefined,
): boolean {
  if (result.success || !paths?.length) return false;
  return result.errors.every((error) =>
    paths.some((path) => path.every((key, i) => error.path[i] === key)),
  );
}

function valueAt(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    current =
      typeof current === "object" && current !== null
        ? (current as Record<string, unknown>)[key]
        : undefined;
  }
  return current;
}
