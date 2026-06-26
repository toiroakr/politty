import type { StandardSchemaV1 } from "@standard-schema/spec";
import type { StandardSchemaLike } from "../core/standard-schema.js";
import type { ArgsSchema } from "../types.js";
import type { ValidationError, ValidationResult } from "./types.js";

/**
 * Standard Schema validation result issue shape (path segments may be either a
 * raw key or a `{ key }` wrapper, per the spec).
 */
type StandardIssue = {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined;
};

/** Read a property as a string, or undefined when absent / not a string. */
function readString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

/**
 * Convert a Standard Schema issue into politty's {@link ValidationError}.
 *
 * The Standard Schema spec only guarantees `message` and `path`, but the common
 * libraries attach richer fields to their issue objects that we recover on a
 * best-effort, vendor-agnostic basis (read by name, never branching on vendor):
 * - `code`: ArkType `code`; Valibot `type` / `kind` (fallback `"custom"`).
 * - `expected`: ArkType and Valibot both expose `expected`.
 * - `received`: Valibot `received` (pre-formatted); ArkType `actual`.
 *
 * Fields that no library provides stay `undefined`, matching the Zod path's
 * optional surface.
 */
function formatStandardIssue(issue: StandardIssue): ValidationError {
  // Build a plain `string[]`: some libraries (ArkType) return an exotic array
  // subclass carrying extra own-properties (e.g. `cache`) that would otherwise
  // leak through `.map`.
  const path: string[] = [];
  for (const segment of issue.path ?? []) {
    path.push(
      typeof segment === "object" && segment !== null && "key" in segment
        ? String(segment.key)
        : String(segment),
    );
  }

  const raw = issue as unknown as Record<string, unknown>;
  const error: ValidationError = {
    path,
    message: issue.message,
    code: readString(raw, "code") ?? readString(raw, "type") ?? readString(raw, "kind") ?? "custom",
  };

  const expected = readString(raw, "expected");
  if (expected !== undefined) error.expected = expected;

  // Valibot pre-formats `received`; ArkType uses `actual`.
  const received = "received" in raw ? raw.received : raw.actual;
  if (received !== undefined) error.received = received;

  return error;
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
