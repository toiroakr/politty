/**
 * Nested object fields.
 *
 * An args field whose schema is an object cannot be given on the command
 * line as a single value, so `extractFields` expands it into one field per
 * property, named by its path in the `flatten` style of its object
 * (`config: { serverPort }` → `config.serverPort`, shown as
 * `--config.server-port`, by default). The parser, help,
 * completion and docs see these as ordinary fields; {@link nestArgs} moves
 * their parsed values back under the object right before validation, so
 * the original schema validates them in place.
 */

import type { NestedKeyStyle } from "../core/arg-registry.js";
import type { ExtractedFields, NestedFieldInfo, ResolvedFieldMeta } from "./field-meta.js";
import { toKebabCase } from "./field-meta.js";

type ResolveField = (name: string, fieldSchema: unknown) => ResolvedFieldMeta;

/**
 * arg() options that only make sense on a field read as a single value, and
 * so are rejected on an object field. Set them on its properties instead.
 */
const UNSUPPORTED_OBJECT_META = [
  "positional",
  "alias",
  "hiddenAlias",
  "env",
  "placeholder",
  "prompt",
  "completion",
  "effect",
  "requiredPackages",
] as const satisfies readonly (keyof ResolvedFieldMeta)[];

/**
 * Expand every object field (in variants and union options too) into its
 * property fields.
 *
 * @param extracted - Fields as the adapter extracted them
 * @param resolve - Resolves a property schema into field metadata
 * @returns `extracted` itself when it has no object field
 */
export function expandNestedFields(
  extracted: ExtractedFields,
  resolve: ResolveField,
): ExtractedFields {
  if (!hasObjectField(extracted)) return extracted;
  return {
    ...extracted,
    fields: expandObjectFields(extracted.fields, resolve),
    ...(extracted.variants && {
      variants: extracted.variants.map((variant) => ({
        ...variant,
        fields: expandObjectFields(variant.fields, resolve),
      })),
    }),
    ...(extracted.unionOptions && {
      unionOptions: extracted.unionOptions.map((option) => expandNestedFields(option, resolve)),
    }),
  };
}

function hasObjectField(extracted: ExtractedFields): boolean {
  return (
    [extracted, ...(extracted.variants ?? [])].some((group) =>
      group.fields.some((field) => field.objectShape),
    ) || (extracted.unionOptions ?? []).some(hasObjectField)
  );
}

/**
 * Replace each object field of a field list with its property fields,
 * recursively.
 *
 * @throws When an object field has metadata only a single value can use
 */
export function expandObjectFields(
  fields: ResolvedFieldMeta[],
  resolve: ResolveField,
): ResolvedFieldMeta[] {
  if (!fields.some((field) => field.objectShape)) return fields;
  return fields.flatMap((field) =>
    field.objectShape
      ? expandObject(field, {
          path: [field.name],
          name: field.name,
          kebab: field.cliName,
          style: field.flatten ?? "dot",
          objectRequired: [],
          resolve,
        })
      : [field],
  );
}

interface ObjectContext {
  /** Property path, starting with the top-level field name */
  path: string[];
  /** Field name prefix of the object's properties */
  name: string;
  /** kebab-case option name prefix of the object's properties */
  kebab: string;
  /** Naming style inherited from the enclosing object */
  style: NestedKeyStyle;
  /** Whether each enclosing object (outermost first) is required */
  objectRequired: boolean[];
  resolve: ResolveField;
}

function expandObject(object: ResolvedFieldMeta, context: ObjectContext): ResolvedFieldMeta[] {
  const unsupported = UNSUPPORTED_OBJECT_META.filter((key) => Boolean(object[key]));
  if (unsupported.length > 0) {
    throw new Error(
      `Invalid arg() metadata for object field "${context.path.join(".")}": ${unsupported.join(", ")} cannot be used on object fields (set them on its properties instead).`,
    );
  }
  const style = object.flatten ?? context.style;
  const objectRequired = [...context.objectRequired, object.required];
  return Object.entries(object.objectShape ?? {}).flatMap(([key, fieldSchema]) => {
    const path = [...context.path, key];
    const name = style === "dot" ? `${context.name}.${key}` : `${context.name}${capitalize(key)}`;
    const kebab = `${context.kebab}${style === "dot" ? "." : "-"}${toKebabCase(key)}`;
    const child = context.resolve(name, fieldSchema);
    // Without a description of its own, a property describes its object.
    const description = child.description ?? object.description;
    if (child.objectShape) {
      return expandObject(
        { ...child, description },
        { ...context, path, name, kebab, style, objectRequired },
      );
    }
    // "camel" shows the field name and accepts the kebab-case form too;
    // the others show the kebab-case form, and the parser accepts the
    // field name as it does for any field.
    const cliName = style === "camel" ? name : kebab;
    const hiddenAlias =
      style === "camel" ? [...new Set([...(child.hiddenAlias ?? []), kebab])] : child.hiddenAlias;
    return [
      {
        ...child,
        cliName,
        hiddenAlias,
        description,
        // Name the value after the property, not the whole option path.
        placeholder: child.placeholder ?? toKebabCase(key).toUpperCase(),
        // The parser reads `--no-` with a lowercase name, and `--no` with a
        // capitalized camelCase one.
        negationDisplay:
          child.negation === true
            ? style === "camel"
              ? `no${capitalize(cliName)}`
              : `no-${cliName}`
            : child.negationDisplay,
        // Only required when every enclosing object is.
        required: child.required && objectRequired.every(Boolean),
        nested: { path, objectRequired },
      },
    ];
  });
}

function capitalize(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

/**
 * Move the values of expanded properties from their flat field name to
 * their property path, for validation against the original schema.
 *
 * An object is created when one of its properties is given. Required
 * objects along the paths of `requiredFields` are created even when none of
 * their properties is given, so their properties' defaults apply and a
 * missing property is reported on its own option. An optional object
 * without values stays absent.
 *
 * @param rawArgs - Parsed args keyed by field name
 * @param fields - Every field the args may hold, including expanded ones
 * @param requiredFields - Fields whose required objects are always created
 * @returns `rawArgs` itself when no field is expanded
 */
export function nestArgs(
  rawArgs: Record<string, unknown>,
  fields: readonly ResolvedFieldMeta[],
  requiredFields: readonly ResolvedFieldMeta[],
): Record<string, unknown> {
  const nestedFields = fields.filter((field) => field.nested);
  if (nestedFields.length === 0) return rawArgs;
  const args = { ...rawArgs };
  for (const field of nestedFields) delete args[field.name];
  for (const field of nestedFields) {
    const value = rawArgs[field.name];
    if (value === undefined) continue;
    const container = containerAt(args, field.nested!, () => true);
    const path = field.nested!.path;
    if (container) container[path[path.length - 1]!] = value;
  }
  for (const field of requiredFields) {
    if (field.nested)
      containerAt(args, field.nested, (depth) => field.nested!.objectRequired[depth]!);
  }
  return args;
}

/**
 * The object holding a nested field's value, creating the missing objects
 * along its path that `create` allows (by depth, outermost first).
 */
function containerAt(
  args: Record<string, unknown>,
  { path }: NestedFieldInfo,
  create: (depth: number) => boolean,
): Record<string, unknown> | undefined {
  let target = args;
  for (const [depth, key] of path.slice(0, -1).entries()) {
    let next = Object.hasOwn(target, key) ? target[key] : undefined;
    if (next === undefined) {
      if (!create(depth)) return undefined;
      next = target[key] = {};
    }
    // A value given in the object's place is the schema's to reject.
    if (typeof next !== "object" || next === null || Array.isArray(next)) return undefined;
    target = next as Record<string, unknown>;
  }
  return target;
}

/**
 * Read a field's value from validated args, following its property path
 * when it was expanded from an object field.
 */
export function getFieldValue(args: Record<string, unknown>, field: ResolvedFieldMeta): unknown {
  if (!field.nested) return args[field.name];
  let value: unknown = args;
  for (const key of field.nested.path) {
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return value;
}
