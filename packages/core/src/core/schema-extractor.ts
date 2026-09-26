/**
 * Schema extraction facade.
 *
 * The neutral field-metadata shapes and naming helpers live in
 * `adapter/field-meta.ts`; the schema-library-specific introspection lives
 * in the registered validator adapter (e.g. `@politty/zod`). This module
 * keeps the historical import surface (`extractFields`, `toCamelCase`, ...)
 * stable for the rest of the codebase and for the package's public
 * exports, and routes each schema to the implementation that understands
 * it.
 */

import { extractInternalFields, isInternalArgsSchema } from "../adapter/internal-args.js";
import { getValidatorAdapter } from "../adapter/registry.js";
import type { AnyCommand, ArgsSchema } from "../types.js";

export {
  getAllAliases,
  toCamelCase,
  toKebabCase,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "../adapter/field-meta.js";

import type { ExtractedFields, ResolvedFieldMeta, UnknownKeysMode } from "../adapter/field-meta.js";

/**
 * Detect the unknown-keys handling mode of an args schema. Works for any
 * schema politty itself attaches to a command (including internal
 * descriptor-based commands), not just user-provided library schemas.
 */
export function getUnknownKeysMode(schema: ArgsSchema): UnknownKeysMode {
  if (isInternalArgsSchema(schema)) {
    return schema.unknownKeys;
  }
  return getValidatorAdapter().getUnknownKeysMode(schema);
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
  return getValidatorAdapter().extractFields(schema);
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

/**
 * Names of the fields every group (discriminated-union variants, or union
 * options) declares with the same role, so they can be shown once for all
 * groups. A field that is positional in one group and an option in another
 * is left to each group's own section.
 *
 * @param groups - Variants or union options
 * @param exclude - Field reported separately, such as the discriminator
 * @returns Names of the fields shared by every group
 */
export function computeCommonFieldNames(
  groups: ReadonlyArray<{ fields: readonly ResolvedFieldMeta[] }>,
  exclude?: string,
): Set<string> {
  const [first, ...rest] = groups;
  const common = new Set<string>();
  for (const field of first?.fields ?? []) {
    if (field.name === exclude) continue;
    const sameRole = rest.every((group) =>
      group.fields.some(
        (f) =>
          f.name === field.name && f.positional === field.positional && f.named === field.named,
      ),
    );
    if (sameRole) common.add(field.name);
  }
  return common;
}

/**
 * Fields accepted as a long option by at least one variant of a
 * discriminated union or union, keeping the first definition that accepts
 * it; for any other schema, the fields accepted as a long option.
 *
 * @param extracted - Extracted fields
 * @returns Fields some variant accepts as `--name`
 */
export function namedFieldsInAnyVariant(extracted: ExtractedFields): ResolvedFieldMeta[] {
  return firstFieldsInAnyVariant(extracted, (field) => field.named);
}

/**
 * Fields taken as a positional argument by at least one variant of a
 * discriminated union or union, keeping the first positional definition; for
 * any other schema, the positional fields.
 *
 * @param extracted - Extracted fields
 * @returns Fields some variant takes as a positional argument
 */
export function positionalFieldsInAnyVariant(extracted: ExtractedFields): ResolvedFieldMeta[] {
  return firstFieldsInAnyVariant(extracted, (field) => field.positional);
}

function firstFieldsInAnyVariant(
  extracted: ExtractedFields,
  predicate: (field: ResolvedFieldMeta) => boolean,
): ResolvedFieldMeta[] {
  const byName = new Map<string, ResolvedFieldMeta>();
  const groups = extracted.variants ?? extracted.unionOptions ?? [];
  for (const field of [extracted.fields, ...groups.map((g) => g.fields)].flat()) {
    if (predicate(field) && !byName.has(field.name)) byName.set(field.name, field);
  }
  return [...byName.values()];
}

/**
 * The fields of the discriminated-union variant whose own definitions read
 * its discriminator value, or all extracted fields when the schema has no
 * discriminator or no variant matches. Variants may define the discriminator
 * itself differently, so each one reads it with its own fields.
 *
 * @param extracted - Extracted fields
 * @param readValues - Reads argument values with the given fields
 * @returns Extracted fields narrowed to the selected variant
 */
export function selectDiscriminatedVariant(
  extracted: ExtractedFields,
  readValues: (fields: ExtractedFields) => Record<string, unknown>,
): ExtractedFields {
  const { discriminator, variants } = extracted;
  if (!discriminator || !variants) return extracted;
  for (const variant of variants) {
    const variantFields = { ...extracted, fields: variant.fields };
    if (readValues(variantFields)[discriminator] === variant.discriminatorValue) {
      return variantFields;
    }
  }
  return extracted;
}

/**
 * The first definition of a field that some variant of a discriminated union
 * or union takes as an option rather than a positional, or `undefined` when
 * every definition is positional.
 *
 * @param extracted - Extracted fields
 * @param name - Field name
 * @returns The option definition of the field
 */
export function optionFieldInAnyVariant(
  extracted: ExtractedFields,
  name: string,
): ResolvedFieldMeta | undefined {
  const groups = extracted.variants ?? extracted.unionOptions ?? [];
  return [extracted.fields, ...groups.map((g) => g.fields)]
    .flat()
    .find((field) => field.name === name && !field.positional);
}
