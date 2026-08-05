import type { ArgsSchema } from "../types.js";
import type { ExtractedFields, ResolvedFieldMeta, UnknownKeysMode } from "./field-meta.js";

/**
 * Validation error details
 */
export interface ValidationError {
  /** Path to the invalid field */
  path: string[];
  /** Error message */
  message: string;
  /** Error code (adapter-specific, e.g. zod issue code) */
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
 * A validator adapter connects a schema library (zod today, valibot in the
 * future) to politty's validator-neutral core. The adapter owns everything
 * that requires knowledge of the library's schema representation:
 *
 * - `extractFields`: introspect an args schema into the neutral
 *   {@link ExtractedFields} shape the parser / help / completion / docs
 *   layers consume.
 * - `resolveFieldMeta`: introspect a single named field schema (for docs
 *   helpers that render raw arg shapes without a full object schema).
 * - `getUnknownKeysMode`: detect how the schema treats unknown keys.
 * - `validate`: validate raw parsed args against the schema, reporting
 *   rich {@link ValidationError}s (including `code`/`received`/`expected`)
 *   that the library's own error output provides.
 *
 * Core never touches a schema except through this interface.
 */
export interface ValidatorAdapter {
  /** Identifier of the backing schema library (e.g. "zod") */
  readonly vendor: string;
  /** Introspect an args schema into neutral field metadata */
  extractFields(schema: ArgsSchema): ExtractedFields;
  /**
   * Resolve a single named field schema (one value of an args-shape record)
   * into neutral field metadata. Used by `politty/docs` helpers that render
   * raw arg shapes without constructing a full object schema.
   */
  resolveFieldMeta(name: string, fieldSchema: unknown): ResolvedFieldMeta;
  /** Detect the unknown-keys handling mode of an args schema */
  getUnknownKeysMode(schema: ArgsSchema): UnknownKeysMode;
  /** Validate raw args against the schema */
  validate(rawArgs: Record<string, unknown>, schema: ArgsSchema): ValidationResult<unknown>;
}
