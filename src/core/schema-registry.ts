/**
 * Schema adapter registry.
 *
 * politty's core is schema-library-agnostic: introspection (field extraction)
 * and validation are delegated to a {@link SchemaAdapter} resolved by the
 * schema's Standard Schema vendor. Adapters are registered by importing the
 * matching entrypoint:
 *
 * - `politty/zod` registers a native Zod adapter (`_def` walk + `safeParse`).
 * - `politty/valibot` registers a native Valibot adapter.
 * - `politty/standard-schema` (also bundled into bare `politty`) registers a
 *   generic adapter that converts any Standard Schema to JSON Schema.
 *
 * politty's built-in internal schema (vendor `"politty"`) is always registered
 * by the core entrypoint, as is the generic Standard Schema fallback.
 */

import type { ArgsSchema } from "../types.js";
import type { ValidationResult } from "../validator/types.js";
import type { ExtractedFields, ResolvedFieldMeta } from "./field-meta.js";
import { getVendor } from "./standard-schema.js";

/**
 * A schema adapter teaches politty how to introspect and validate schemas of a
 * particular Standard Schema vendor (or, as a fallback, any vendor).
 */
export interface SchemaAdapter {
  /**
   * Standard Schema vendor strings this adapter handles (e.g. `["zod"]`,
   * `["valibot"]`, `["politty"]`). The generic adapter registers as the
   * fallback instead of by vendor.
   */
  readonly vendors: readonly string[];
  /**
   * Optionally pre-process a schema so later synchronous {@link extractFields}
   * calls work (e.g. async JSON Schema conversion). No-op adapters may omit it.
   */
  prepare?(schema: ArgsSchema): Promise<void>;
  /** Extract all fields (and any union/intersection structure) from a schema. */
  extractFields(schema: ArgsSchema): ExtractedFields;
  /** Resolve a single field's metadata (used for raw arg *shapes* in docs). */
  resolveField(name: string, fieldSchema: unknown): ResolvedFieldMeta;
  /** Validate raw args against the schema; may be sync or async. */
  validate(
    rawArgs: Record<string, unknown>,
    schema: ArgsSchema,
  ): ValidationResult<unknown> | Promise<ValidationResult<unknown>>;
}

const byVendor = new Map<string, SchemaAdapter>();
let fallbackAdapter: SchemaAdapter | undefined;

/**
 * Register a schema adapter. Pass `{ fallback: true }` to also make it the
 * adapter used for any vendor without a dedicated registration (the generic
 * Standard Schema adapter does this).
 */
export function registerSchemaAdapter(
  adapter: SchemaAdapter,
  options?: { fallback?: boolean },
): void {
  for (const vendor of adapter.vendors) {
    byVendor.set(vendor, adapter);
  }
  if (options?.fallback) {
    fallbackAdapter = adapter;
  }
}

/**
 * Resolve the adapter for a schema by its vendor, falling back to the generic
 * adapter. Throws a descriptive error when no adapter is registered — the fix
 * is to import the matching entrypoint (`politty/zod`, `politty/valibot`, or
 * `politty/standard-schema`).
 */
export function resolveSchemaAdapter(schema: unknown): SchemaAdapter {
  const vendor = getVendor(schema);
  const adapter = (vendor !== undefined ? byVendor.get(vendor) : undefined) ?? fallbackAdapter;
  if (!adapter) {
    throw new Error(
      `politty: no schema adapter registered for vendor ${vendor ? `"${vendor}"` : "(unknown)"}. ` +
        `Import the matching entrypoint — "politty/zod", "politty/valibot", or "politty/standard-schema".`,
    );
  }
  return adapter;
}
