/**
 * Nested object fields.
 *
 * An args field whose schema is an object cannot be given on the command
 * line as a single value, so `extractFields` expands it into one field per
 * leaf (`config: { port }` → `--config.port`). Every other layer (parser,
 * help, completion, docs, prompts) sees the leaves as ordinary fields keyed
 * by their flat `name`; {@link nestFlattenedArgs} moves the parsed values
 * back under their property path right before validation.
 */

import type { NestedKeyStyle } from "../core/arg-registry.js";
import type { ExtractedFields, NestedFieldInfo, ResolvedFieldMeta } from "./field-meta.js";
import { getAllAliases, toCamelCase, toKebabCase } from "./field-meta.js";

type ResolveChild = (name: string, fieldSchema: unknown) => ResolvedFieldMeta;

/**
 * arg() options that only make sense on a field read as a single value, and
 * so are rejected on an object field.
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
  "overrideBuiltinAlias",
] as const satisfies readonly (keyof ResolvedFieldMeta)[];

/**
 * Expand every object field of the extracted fields (variants and union
 * options included) into its leaf fields.
 *
 * @param extracted - Fields as the adapter extracted them
 * @param resolveChild - Resolves a property schema into field metadata
 * @returns The same object when there is no object field, else the expanded fields
 * @throws When two options resolve to the same name, or an object field has unsupported metadata
 */
export function flattenNestedFields(
  extracted: ExtractedFields,
  resolveChild: ResolveChild,
): ExtractedFields {
  if (!hasObjectField(extracted)) return extracted;
  const flattenGroup = (fields: ResolvedFieldMeta[]): ResolvedFieldMeta[] => {
    const flat = fields.flatMap((field) =>
      field.objectShape ? expandObjectField(field, resolveChild) : [field],
    );
    checkNestedCollisions(flat);
    return flat;
  };
  const { variants, unionOptions } = extracted;
  return {
    ...extracted,
    fields: flattenGroup(extracted.fields),
    ...(variants && {
      variants: variants.map((variant) => ({ ...variant, fields: flattenGroup(variant.fields) })),
    }),
    ...(unionOptions && {
      unionOptions: unionOptions.map((option) => flattenNestedFields(option, resolveChild)),
    }),
  };
}

function hasObjectField(extracted: ExtractedFields): boolean {
  return (
    extracted.fields.some((f) => f.objectShape) ||
    (extracted.variants ?? []).some((v) => v.fields.some((f) => f.objectShape)) ||
    (extracted.unionOptions ?? []).some(hasObjectField)
  );
}

function capitalize(key: string): string {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function expandObjectField(
  root: ResolvedFieldMeta,
  resolveChild: ResolveChild,
): ResolvedFieldMeta[] {
  const leaves: ResolvedFieldMeta[] = [];
  const walk = (
    object: ResolvedFieldMeta,
    path: string[],
    names: { name: string; cliName: string },
    inherited: NestedKeyStyle,
    enclosing: NestedFieldInfo["objects"],
  ): void => {
    const unsupported = UNSUPPORTED_OBJECT_META.filter((key) => Boolean(object[key]));
    if (unsupported.length > 0) {
      throw new Error(
        `Invalid arg() metadata for object field "${path.join(".")}": ${unsupported.join(", ")} cannot be used on object fields (set them on its properties instead).`,
      );
    }
    const style = object.flatten ?? inherited;
    // A camelCase parent prefix keeps camelCase all the way down.
    const cliPrefix = style === "camel" && path.length === 1 ? names.name : names.cliName;
    const objects = [
      ...enclosing,
      {
        required: (enclosing.at(-1)?.required ?? true) && object.required,
        defaultValue: object.defaultValue,
      },
    ];

    for (const [key, fieldSchema] of Object.entries(object.objectShape ?? {})) {
      const child = resolveChild(key, fieldSchema);
      const childPath = [...path, key];
      const name = style === "dot" ? `${names.name}.${key}` : `${names.name}${capitalize(key)}`;
      const cliName =
        style === "dot"
          ? `${cliPrefix}.${toKebabCase(key)}`
          : style === "kebab"
            ? `${cliPrefix}-${toKebabCase(key)}`
            : `${cliPrefix}${capitalize(key)}`;

      if (child.objectShape) {
        walk(child, childPath, { name, cliName }, style, objects);
        continue;
      }

      const negationDisplay =
        child.negation === true
          ? style === "camel"
            ? `no${capitalize(cliName)}`
            : `no-${cliName}`
          : child.negationDisplay;
      leaves.push({
        ...child,
        name,
        cliName,
        // Name the value after the property, not the whole option path.
        placeholder: child.placeholder ?? toKebabCase(key).toUpperCase(),
        required: objects.at(-1)!.required && child.required,
        defaultValue: child.defaultValue ?? defaultFromEnclosing(objects, childPath),
        negationDisplay,
        nested: { path: childPath, objects },
      });
    }
  };
  walk(root, [root.name], { name: root.name, cliName: root.cliName }, "dot", []);
  return leaves;
}

/**
 * The value at `path` in the nearest enclosing object default that has one.
 * `objects[i]` is the object at `path.slice(0, i + 1)`.
 */
function defaultFromEnclosing(objects: NestedFieldInfo["objects"], path: string[]): unknown {
  for (let i = objects.length - 1; i >= 0; i--) {
    let value = objects[i]!.defaultValue;
    for (const key of path.slice(i + 1)) {
      value = isPlainObject(value) ? value[key] : undefined;
    }
    if (value !== undefined) return value;
  }
  return undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fieldLabel(field: ResolvedFieldMeta): string {
  return field.nested ? field.nested.path.join(".") : field.name;
}

/**
 * Reject a nested leaf whose option name (or its camelCase form) is also the
 * name, option name or long alias of another field. Collisions between two
 * top-level fields are left to the command validator.
 */
function checkNestedCollisions(fields: ResolvedFieldMeta[]): void {
  if (!fields.some((f) => f.nested)) return;
  const owners = new Map<string, ResolvedFieldMeta>();
  for (const field of fields) {
    // Displayed names first, so the error cites the option users see.
    const longNames = new Set([
      field.cliName,
      ...getAllAliases(field).filter((a) => a.length > 1),
      field.name,
      toCamelCase(field.cliName),
    ]);
    for (const longName of longNames) {
      const owner = owners.get(longName);
      if (owner && owner !== field && (owner.nested || field.nested)) {
        throw new Error(
          `Field "${fieldLabel(field)}" (--${field.cliName}) collides with field "${fieldLabel(owner)}" (--${owner.cliName}) on "--${longName}". Rename one of them or choose another flatten style.`,
        );
      }
      owners.set(longName, field);
    }
  }
}

/**
 * Move the values of nested leaves from their flat `name` to their property
 * path. An optional enclosing object is created only when one of its leaves
 * has a value, starting from the object's default so unspecified properties
 * keep it; otherwise it stays absent and the schema's own default (or
 * optionality) applies. A required object of a plain object schema is
 * always created, so a missing value is reported on the leaf option rather
 * than on an object no option names.
 *
 * @param rawArgs - Parsed args keyed by field name
 * @param extracted - Extracted fields of the schema
 * @returns `rawArgs` itself when there is nothing to nest, else a nested copy
 */
export function nestFlattenedArgs(
  rawArgs: Record<string, unknown>,
  extracted: ExtractedFields,
): Record<string, unknown> {
  const leaves = new Map<string, ResolvedFieldMeta & { nested: NestedFieldInfo }>();
  const collect = (group: ExtractedFields): void => {
    const fields = [group.fields, ...(group.variants ?? []).map((v) => v.fields)].flat();
    for (const field of fields) {
      if (field.nested && !leaves.has(field.name))
        leaves.set(field.name, { ...field, nested: field.nested });
    }
    for (const option of group.unionOptions ?? []) collect(option);
  };
  collect(extracted);
  if (leaves.size === 0) return rawArgs;

  // Variants and union options decide which objects exist, so only a plain
  // object schema pre-creates its required ones.
  const createRequired = !extracted.variants && !extracted.unionOptions;
  const result: Record<string, unknown> = { ...rawArgs };
  const ensureObjects = (leaf: { nested: NestedFieldInfo }, depth: number) => {
    let target = result;
    for (let i = 0; i < depth; i++) {
      const key = leaf.nested.path[i]!;
      const current = target[key];
      const base = isPlainObject(current) ? current : leaf.nested.objects[i]!.defaultValue;
      // Copy at every level so a shared default object is never mutated.
      const object = isPlainObject(base) ? { ...base } : {};
      target[key] = object;
      target = object;
    }
    return target;
  };

  for (const leaf of leaves.values()) {
    const value = rawArgs[leaf.name];
    delete result[leaf.name];
    const { path, objects } = leaf.nested;
    if (value !== undefined) {
      ensureObjects(leaf, path.length - 1)[path[path.length - 1]!] = value;
    } else if (createRequired) {
      const requiredDepth = objects.findIndex((o) => !o.required);
      ensureObjects(leaf, requiredDepth === -1 ? objects.length : requiredDepth);
    }
  }
  return result;
}

/**
 * Read a field's value from validated (nested) args.
 */
export function getFieldValue(args: Record<string, unknown>, field: ResolvedFieldMeta): unknown {
  if (!field.nested) return args[field.name];
  let value: unknown = args;
  for (const key of field.nested.path) {
    value = isPlainObject(value) ? value[key] : undefined;
  }
  return value;
}
