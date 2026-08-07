/**
 * Schema extraction facade.
 *
 * The neutral field-metadata shapes and naming helpers live in
 * `adapter/field-meta.ts`; the zod-specific introspection lives in
 * `zod/adapter.ts`. This module keeps the historical import surface
 * (`extractFields`, `toCamelCase`, ...) stable for the rest of the
 * codebase and for the package's public exports, and routes each schema
 * to the implementation that understands it.
 */

import { extractInternalFields, isInternalArgsSchema } from "../adapter/internal-args.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import { zodAdapter } from "../zod/adapter.js";

export {
  getAllAliases,
  toCamelCase,
  toKebabCase,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "../adapter/field-meta.js";

import type { z } from "zod";
import type { ExtractedFields, UnknownKeysMode } from "../adapter/field-meta.js";
import { getUnknownKeysMode as getZodUnknownKeysMode } from "../zod/adapter.js";

/**
 * Detect the unknown-keys handling mode of an args schema. Works for any
 * schema politty itself attaches to a command (including internal
 * descriptor-based commands), not just user-provided zod schemas.
 */
export function getUnknownKeysMode(schema: z.ZodType): UnknownKeysMode {
  if (isInternalArgsSchema(schema)) {
    return schema.unknownKeys;
  }
  return getZodUnknownKeysMode(schema);
}

/**
 * Extract all fields from a schema
 *
 * @param schema - The args schema (ZodObject, ZodDiscriminatedUnion, etc.)
 * @returns Extracted field information
 */
export function extractFields(schema: ArgsSchema): ExtractedFields {
  // politty's own internal commands describe their args with validator-free
  // descriptors so they never pull a schema library into the import graph.
  if (isInternalArgsSchema(schema)) {
    return extractInternalFields(schema);
  }
  return zodAdapter.extractFields(schema);
}

/**
 * Get extracted fields from a command
 *
 * @param command - The command to extract fields from
 * @returns Extracted field information, or null if command has no args schema
 */
export function getExtractedFields(command: AnyCommand): ExtractedFields | null {
  if (!command.args) {
    return null;
  }
  return extractFields(command.args);
}
