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
import {
  getUnflattenOptions,
  pathResolver,
  rejectUnflattenedOption,
} from "../adapter/unflatten.js";
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

const validatedPackageFields = new WeakSet<ExtractedFields>();
const annotatedFields = new WeakMap<ExtractedFields, ExtractedFields>();

/**
 * Extract all fields from a schema
 *
 * @param schema - The args schema (ZodObject, ZodDiscriminatedUnion, etc.)
 * @returns Extracted field information
 */
export function extractFields(schema: ArgsSchema): ExtractedFields {
  const extracted = isInternalArgsSchema(schema)
    ? extractInternalFields(schema)
    : annotateUnflattened(schema, getValidatorAdapter().extractFields(schema));
  if (!validatedPackageFields.has(extracted)) {
    validatePackageFields(extracted);
    validatedPackageFields.add(extracted);
  }
  return extracted;
}

function rejectUnflattenedOptions(extracted: ExtractedFields): void {
  for (const option of extracted.unionOptions ?? []) {
    rejectUnflattenedOption(option.schema);
    rejectUnflattenedOptions(option);
  }
}

/**
 * Give the fields of a schema wrapped by an `unflatten` helper the nested
 * path of their flat names, memoized so repeated calls keep returning the
 * same object.
 */
function annotateUnflattened(schema: ArgsSchema, extracted: ExtractedFields): ExtractedFields {
  rejectUnflattenedOptions(extracted);
  const options = getUnflattenOptions(schema);
  if (!options) return extracted;
  let annotated = annotatedFields.get(extracted);
  if (!annotated) {
    annotated = annotateFields(extracted, pathResolver(options));
    annotatedFields.set(extracted, annotated);
  }
  return annotated;
}

/**
 * Give every field of an extraction, including the fields of its variants and
 * union options that parsing swaps in once a branch is selected, the nested
 * path of its flat name.
 */
function annotateFields(
  extracted: ExtractedFields,
  pathOf: (key: string) => string[],
): ExtractedFields {
  const annotate = (fields: ResolvedFieldMeta[]) =>
    fields.map((field) => {
      const path = pathOf(field.name);
      return path.length > 1 ? { ...field, nested: { path } } : field;
    });
  return {
    ...extracted,
    fields: annotate(extracted.fields),
    ...(extracted.variants && {
      variants: extracted.variants.map((variant) => ({
        ...variant,
        fields: annotate(variant.fields),
      })),
    }),
    ...(extracted.unionOptions && {
      unionOptions: extracted.unionOptions.map((option) => annotateFields(option, pathOf)),
    }),
  };
}

function validatePackageFields(extracted: ExtractedFields): void {
  const groups = extracted.variants ?? [extracted];
  for (const group of groups) {
    for (const field of group.fields) {
      if (
        field.requiredPackages?.length &&
        field.type !== "boolean" &&
        field.name !== extracted.discriminator
      ) {
        throw new Error(
          `Invalid requiredPackages for field "${field.name}": requiredPackages can only be used on boolean fields or discriminators.`,
        );
      }
    }
  }
  for (const option of extracted.unionOptions ?? []) validatePackageFields(option);
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
          f.name === field.name &&
          f.positional === field.positional &&
          f.named === field.named &&
          samePackageRequirements(f.requiredPackages, field.requiredPackages),
      ),
    );
    if (sameRole) common.add(field.name);
  }
  return common;
}

function samePackageRequirements(
  left: ResolvedFieldMeta["requiredPackages"],
  right: ResolvedFieldMeta["requiredPackages"],
): boolean {
  return (
    (left?.length ?? 0) === (right?.length ?? 0) &&
    (left ?? []).every((requirement, index) => {
      const other = right?.[index];
      return (
        requirement.name === other?.name &&
        requirement.install === other.install &&
        requirement.from?.toString() === other.from?.toString()
      );
    })
  );
}

/**
 * Fields accepted as a long option by at least one variant of a
 * discriminated union or union, keeping the first definition that accepts
 * it with the aliases every accepting variant gives it; for any other
 * schema, the fields accepted as a long option.
 *
 * @param extracted - Extracted fields
 * @returns Fields some variant accepts as `--name`
 */
export function namedFieldsInAnyVariant(extracted: ExtractedFields): ResolvedFieldMeta[] {
  const definitions = definitionsInAnyVariant(extracted).filter((field) => field.named);
  return firstFieldsInAnyVariant(extracted, (field) => field.named).map((field) => {
    const same = definitions.filter((f) => f.name === field.name);
    const alias = [...new Set(same.flatMap((f) => f.alias ?? []))];
    const hiddenAlias = [...new Set(same.flatMap((f) => f.hiddenAlias ?? []))];
    return {
      ...field,
      alias: alias.length > 0 ? alias : field.alias,
      hiddenAlias: hiddenAlias.length > 0 ? hiddenAlias : field.hiddenAlias,
    };
  });
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

/**
 * Fields taken as an option rather than a positional by at least one variant
 * of a discriminated union or union, keeping the first such definition; for
 * any other schema, the non-positional fields.
 *
 * @param extracted - Extracted fields
 * @returns Fields some variant takes as an option
 */
export function optionFieldsInAnyVariant(extracted: ExtractedFields): ResolvedFieldMeta[] {
  return firstFieldsInAnyVariant(extracted, (field) => !field.positional);
}

export function definitionsInAnyVariant(extracted: ExtractedFields): ResolvedFieldMeta[] {
  const groups = extracted.variants ?? extracted.unionOptions ?? [];
  return [extracted.fields, ...groups.map((g) => g.fields)].flat();
}

function firstFieldsInAnyVariant(
  extracted: ExtractedFields,
  predicate: (field: ResolvedFieldMeta) => boolean,
): ResolvedFieldMeta[] {
  const byName = new Map<string, ResolvedFieldMeta>();
  for (const field of definitionsInAnyVariant(extracted)) {
    if (predicate(field) && !byName.has(field.name)) byName.set(field.name, field);
  }
  return [...byName.values()];
}

function sameFieldMetadata(left: ResolvedFieldMeta, right: ResolvedFieldMeta): boolean {
  return (
    left.effect === right.effect &&
    samePackageRequirements(left.requiredPackages, right.requiredPackages) &&
    (left.nested?.path ?? []).join("\0") === (right.nested?.path ?? []).join("\0")
  );
}

function optionsDefineFieldsDifferently(
  options: readonly Pick<ExtractedFields, "fields" | "unionOptions" | "variants">[],
): boolean {
  const first = new Map<string, ResolvedFieldMeta>();
  const definingOptions = new Map<string, number>();
  for (const option of options) {
    if (option.unionOptions && optionsDefineFieldsDifferently(option.unionOptions)) return true;
    if (option.variants && optionsDefineFieldsDifferently(option.variants)) return true;
    for (const field of option.fields) {
      const previous = first.get(field.name);
      if (!previous) first.set(field.name, field);
      else if (!sameFieldMetadata(previous, field)) return true;
      definingOptions.set(field.name, (definingOptions.get(field.name) ?? 0) + 1);
    }
  }
  return [...first].some(
    ([name, field]) =>
      definingOptions.get(name)! < options.length &&
      (field.effect !== undefined || !!field.requiredPackages?.length),
  );
}

/**
 * The fields of the plain-union option that accepts the arguments, so that
 * `effect`, `requiredPackages` and nested paths come from the option that
 * actually validated rather than from the first option defining the name.
 * Options are tried in order, like the union itself. Options are only
 * re-validated when they define a same-named field with different metadata,
 * which keeps transforms from running again for every other union.
 *
 * @param extracted - Extracted fields
 * @param accepts - Whether an option's schema accepts the arguments
 * @param readValues - Reads argument values with the given fields, to select
 *   the variant of an accepting discriminated-union option
 * @returns Extracted fields narrowed to the accepting option, or the input
 *   when it is not a plain union, its options agree, or none accepts
 */
export function selectAcceptingUnionOption(
  extracted: ExtractedFields,
  accepts: (schema: ExtractedFields["schema"]) => boolean,
  readValues: (fields: ExtractedFields) => Record<string, unknown>,
): ExtractedFields {
  const options = extracted.unionOptions;
  if (extracted.discriminator || !options || !optionsDefineFieldsDifferently(options)) {
    return extracted;
  }
  for (const option of options) {
    if (!accepts(option.schema)) continue;
    const selected =
      option.discriminator && option.variants
        ? selectDiscriminatedVariant(option, readValues)
        : selectAcceptingUnionOption(option, accepts, readValues);
    return { ...extracted, fields: selected.fields };
  }
  return extracted;
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
  if (!discriminator || !variants) {
    const options = extracted.unionOptions ?? [];
    const selected = options.map((option) => selectDiscriminatedVariant(option, readValues));
    if (selected.every((option, i) => option === options[i])) return extracted;
    const viable = selected.filter((option, i) => {
      const values = readValues(option);
      const original = options[i]!;
      if (
        original.discriminator &&
        values[original.discriminator] !== undefined &&
        option === original
      )
        return false;
      const names = new Set(option.fields.map((field) => field.name));
      return !extracted.fields.some(
        (field) => values[field.name] !== undefined && !names.has(field.name),
      );
    });
    if (!viable.length) return extracted;
    const fields = new Map<string, ResolvedFieldMeta>();
    for (const option of viable)
      for (const field of option.fields) {
        const previous = fields.get(field.name);
        if (!previous) fields.set(field.name, field);
        else
          fields.set(field.name, {
            ...previous,
            type: previous.type === field.type ? previous.type : "unknown",
            named: previous.named || field.named,
            positional: previous.positional || field.positional,
            alias: [...new Set([...(previous.alias ?? []), ...(field.alias ?? [])])],
            hiddenAlias: [
              ...new Set([...(previous.hiddenAlias ?? []), ...(field.hiddenAlias ?? [])]),
            ],
          });
      }
    return { ...extracted, fields: [...fields.values()] };
  }
  const candidates = variants.map((variant) => {
    const fields = { ...extracted, fields: variant.fields };
    return { variant, fields, value: readValues(fields)[discriminator] };
  });
  for (const { variant, fields, value } of candidates) {
    if (value !== undefined && String(value) === variant.discriminatorValue) {
      return fields;
    }
  }
  for (const { variant, fields, value } of candidates) {
    if (
      value !== undefined &&
      variant.normalizeDiscriminator &&
      String(variant.normalizeDiscriminator(value)) === variant.discriminatorValue
    )
      return fields;
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
  return optionFieldsInAnyVariant(extracted).find((field) => field.name === name);
}
