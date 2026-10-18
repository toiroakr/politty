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
import { givenValueFate, nestingCandidates, type NestingGroup } from "../adapter/nested-fields.js";
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
  return validateArgsBranch(rawArgs, schema).result;
}

/**
 * {@link validateArgs}, also telling which branch of the schema accepted the
 * args: the fields and expanded objects whose paths the validated args
 * follow. `branch` is absent when no field is nested, as every branch then
 * reads its fields at their names.
 */
export function validateArgsBranch<T extends ArgsSchema>(
  rawArgs: Record<string, unknown>,
  schema: T,
): { result: ValidationResult<InferSchemaOutput<T>>; branch?: NestingGroup | undefined } {
  if (isInternalArgsSchema(schema)) {
    return {
      result: validateInternalArgs(rawArgs, schema) as ValidationResult<InferSchemaOutput<T>>,
    };
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
      // Every union option enclosing the branch must accept it too.
      for (const option of candidate.branchSchemas ?? []) {
        if (option === candidate.branchSchema) continue;
        const enclosing = adapter.validate(candidate.args, option);
        if (!enclosing.success) {
          own = enclosing;
          break;
        }
      }
      own ??= adapter.validate(candidate.args, candidate.branchSchema);
      if (!own.success) {
        // Prefer the option that rejects the fewest given values: one that
        // only misses values says more than one the given values rule out.
        if (
          !branchFailure ||
          issuesUnder(own, candidate.givenPaths) < issuesUnder(branchFailure, candidate.givenPaths)
        )
          branchFailure = own;
        continue;
      }
    }
    const result = adapter.validate(candidate.args, schema);
    // The branch whose output the union returns.
    let producer = candidate.group;
    if (result.success && own?.success && candidate.precedingBranches?.length) {
      // The union takes the first option accepting the args; if that is an
      // earlier option without some of the given fields, it drops their
      // values (before any transform could tell), so never accept it.
      let firstOutput: unknown;
      const first = candidate.precedingBranches.find((earlier) => {
        let output: ValidationResult<unknown> | undefined;
        for (const option of earlier.schemas) {
          output = adapter.validate(candidate.args, option);
          if (!output.success) return false;
        }
        firstOutput = output?.success ? output.data : undefined;
        return true;
      });
      // A value kept only as an unknown key may still be dropped below it
      // (by a typed catchall), so check that the option's output holds it,
      // unless a transform reshaped the object keeping it.
      const dropped = first
        ? (candidate.given ?? []).filter(({ path }) => {
            const fate = givenValueFate(first, path);
            if (fate.fate !== "retained") return fate.fate === "dropped";
            const container = valueAt(firstOutput, fate.container);
            return (
              typeof container === "object" &&
              container !== null &&
              valueAt(firstOutput, path) === undefined
            );
          })
        : [];
      if (dropped.length > 0) {
        const message = `${dropped.map(({ path }) => path.join(".")).join(", ")} would be ignored: another schema option accepts the arguments without them.`;
        reported ??= { success: false, errors: [{ path: [], message, code: "invalid_union" }] };
        continue;
      }
      if (first) producer = first.group;
    }
    if (result.success) {
      if (!candidate.diagnosticOnly)
        return {
          result: result as ValidationResult<InferSchemaOutput<T>>,
          branch: producer,
        };
      last = {
        success: false,
        errors: [{ path: [], message: candidate.diagnosticOnly.message, code: "invalid_union" }],
      };
      continue;
    }
    last = result;
    if (!candidate.diagnosticOnly) reported ??= result;
  }
  return { result: (reported ?? branchFailure ?? last) as ValidationResult<InferSchemaOutput<T>> };
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
