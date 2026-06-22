import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { StandardSchemaLike } from "../core/standard-schema.js";
import type { ArgsSchema } from "../types.js";
import type { ValidationError, ValidationResult } from "./zod-validator.js";

/**
 * Standard Schema validation result issue shape (path segments may be either a
 * raw key or a `{ key }` wrapper, per the spec).
 */
type StandardIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined;
};

/**
 * Convert a Standard Schema issue into politty's {@link ValidationError}.
 *
 * Standard Schema only guarantees `message` and `path`, so `code` is reported
 * as a generic `"custom"` and `expected`/`received` are omitted.
 */
function formatStandardIssue(issue: StandardIssue): ValidationError {
  const path = (issue.path ?? []).map((segment) =>
    typeof segment === "object" && segment !== null && "key" in segment
      ? String(segment.key)
      : String(segment),
  );
  return {
    path,
    message: issue.message,
    code: "custom",
  };
}

/**
 * Validate raw arguments against a non-Zod Standard Schema.
 *
 * Uses the schema's `~standard.validate`, awaiting it when the library performs
 * asynchronous validation. Returns the same {@link ValidationResult} shape used
 * by the Zod validator so the runner can treat both paths uniformly.
 */
export async function validateStandard<T extends ArgsSchema>(
  rawArgs: Record<string, unknown>,
  schema: T,
): Promise<ValidationResult<StandardSchemaV1.InferOutput<T>>> {
  const std = (schema as unknown as StandardSchemaLike)["~standard"];
  const maybe = std.validate(rawArgs);
  const result = (
    typeof (maybe as PromiseLike<unknown>)?.then === "function" ? await maybe : maybe
  ) as { value: unknown; issues?: undefined } | { issues: ReadonlyArray<StandardIssue> };

  if (result.issues === undefined) {
    return {
      success: true,
      data: result.value as StandardSchemaV1.InferOutput<T>,
    };
  }

  return {
    success: false,
    errors: result.issues.map(formatStandardIssue),
  };
}
