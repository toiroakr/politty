/**
 * Nested object fields.
 *
 * An args field whose schema is an object cannot be given on the command
 * line as a single value, so `extractFields` expands it into one field per
 * leaf (`config: { port }` → `--config.port`). Every other layer (parser,
 * help, completion, docs, prompts) sees the leaves as ordinary fields keyed
 * by their flat `name`; {@link nestingCandidates} moves the parsed values
 * back under their property path right before validation.
 */

import type { NestedKeyStyle } from "../core/arg-registry.js";
import type { ArgsSchema } from "../types.js";
import type { ExtractedFields, NestedObjectInfo, ResolvedFieldMeta } from "./field-meta.js";
import { getAllAliases, mergeIntersectionField, toCamelCase, toKebabCase } from "./field-meta.js";

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
  const flattenGroup = (fields: ResolvedFieldMeta[]) => {
    const nestedObjects: NestedObjectInfo[] = [];
    const flat = fields.flatMap((field) =>
      field.objectShape ? expandObjectField(field, resolveChild, nestedObjects) : [field],
    );
    checkNestedCollisions(flat);
    return { fields: flat, nestedObjects };
  };
  const { variants, unionOptions } = extracted;
  const flatVariants = variants?.map((variant) => ({
    ...variant,
    ...flattenGroup(variant.fields),
  }));
  const flatOptions = unionOptions?.map((option) => flattenNestedFields(option, resolveChild));
  const branches = [...(flatVariants ?? []), ...(flatOptions ?? [])];
  if (branches.length === 0) return { ...extracted, ...flattenGroup(extracted.fields) };

  // Branches are exclusive, so each checked its own collisions; the
  // combined list takes each name's first definition, with an object
  // field's place holding the leaves every branch expands it into.
  const fields: ResolvedFieldMeta[] = [];
  const names = new Set<string>();
  const add = (field: ResolvedFieldMeta): void => {
    if (names.has(field.name)) return;
    names.add(field.name);
    fields.push(field);
  };
  for (const field of extracted.fields) {
    if (!field.objectShape) {
      add(field);
      continue;
    }
    for (const branch of branches) {
      for (const leaf of branch.fields) if (leaf.nested?.path[0] === field.name) add(leaf);
    }
  }
  for (const branch of branches) for (const leaf of branch.fields) if (leaf.nested) add(leaf);
  return {
    ...extracted,
    fields,
    nestedObjects: branches.flatMap((branch) => branch.nestedObjects ?? []),
    ...(flatVariants && { variants: flatVariants }),
    ...(flatOptions && { unionOptions: flatOptions }),
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

/**
 * Expand an object field into its leaves, recording the field and every
 * nested object (even one without leaves) in `nestedObjects`.
 */
function expandObjectField(
  root: ResolvedFieldMeta,
  resolveChild: ResolveChild,
  nestedObjects: NestedObjectInfo[],
): ResolvedFieldMeta[] {
  const leaves: ResolvedFieldMeta[] = [];
  const walk = (
    object: ResolvedFieldMeta,
    path: string[],
    names: { name: string; cliName: string },
    inherited: { style: NestedKeyStyle; description: string | undefined },
    enclosing: Array<{ required: boolean; defaultValue: unknown }>,
  ): void => {
    const unsupported = UNSUPPORTED_OBJECT_META.filter((key) => Boolean(object[key]));
    if (unsupported.length > 0) {
      throw new Error(
        `Invalid arg() metadata for object field "${path.join(".")}": ${unsupported.join(", ")} cannot be used on object fields (set them on its properties instead).`,
      );
    }
    nestedObjects.push({ path, required: object.required, defaultValue: object.defaultValue });
    const style = object.flatten ?? inherited.style;
    const description = object.description ?? inherited.description;
    // A camelCase parent prefix keeps camelCase all the way down.
    const cliPrefix = style === "camel" && path.length === 1 ? names.name : names.cliName;
    // Whether this object, and so every enclosing one, must be present.
    const objects = [
      ...enclosing,
      {
        required: (enclosing.at(-1)?.required ?? true) && object.required,
        defaultValue: object.defaultValue,
      },
    ];

    for (const [key, schemas] of propertySchemas(object)) {
      const child = schemas
        .map((fieldSchema) => resolveChild(key, fieldSchema))
        .reduce((merged, definition) => mergeIntersectionField(merged, definition));
      const childPath = [...path, key];
      const name = style === "dot" ? `${names.name}.${key}` : `${names.name}${capitalize(key)}`;
      const cliName =
        style === "dot"
          ? `${cliPrefix}.${toKebabCase(key)}`
          : style === "kebab"
            ? `${cliPrefix}-${toKebabCase(key)}`
            : `${cliPrefix}${capitalize(key)}`;

      if (child.objectShape) {
        walk(child, childPath, { name, cliName }, { style, description }, objects);
        continue;
      }

      // Runtime reads `--no-` followed by a lowercase name, so a non-camel
      // negation spells out a camelCase prefix in kebab-case.
      const negationDisplay =
        child.negation === true
          ? style === "camel"
            ? `no${capitalize(cliName)}`
            : `no-${toKebabCase(cliName)}`
          : child.negationDisplay;
      // Like every other option, accept both the kebab-case and camelCase
      // forms; the parser derives camelCase from `name`, so a camelCase
      // option only needs its kebab-case form added (hidden from help).
      const kebabName = toKebabCase(cliName);
      const hiddenAlias =
        kebabName === cliName ? child.hiddenAlias : [...(child.hiddenAlias ?? []), kebabName];
      leaves.push({
        ...child,
        name,
        cliName,
        hiddenAlias,
        // Without a description of its own, an option describes its object.
        description: child.description ?? description,
        // Name the value after the property, not the whole option path.
        placeholder: child.placeholder ?? toKebabCase(key).toUpperCase(),
        required: objects.at(-1)!.required && child.required,
        defaultValue:
          child.defaultValue !== undefined
            ? child.defaultValue
            : defaultFromEnclosing(objects, childPath),
        negationDisplay,
        nested: { path: childPath },
      });
    }
  };
  walk(
    root,
    [root.name],
    { name: root.name, cliName: root.cliName },
    { style: "dot", description: undefined },
    [],
  );
  return leaves;
}

/**
 * Property schemas of an object field by key, with every intersection
 * member's schema for a property more than one member defines.
 */
function propertySchemas(object: ResolvedFieldMeta): Map<string, unknown[]> {
  const properties = new Map<string, unknown[]>();
  for (const shape of object.objectShapes ?? [object.objectShape ?? {}]) {
    for (const [key, fieldSchema] of Object.entries(shape)) {
      properties.set(key, [...(properties.get(key) ?? []), fieldSchema]);
    }
  }
  return properties;
}

/**
 * The value at `path` in the nearest enclosing object default that has one.
 * `objects[i]` is the object at `path.slice(0, i + 1)`.
 */
function defaultFromEnclosing(objects: Array<{ defaultValue: unknown }>, path: string[]): unknown {
  for (let i = objects.length - 1; i >= 0; i--) {
    let value = objects[i]!.defaultValue;
    for (const key of path.slice(i + 1)) {
      value = isPlainObject(value) ? value[key] : undefined;
    }
    if (value !== undefined) return value;
  }
  return undefined;
}

/**
 * Whether a value is a plain object (object literal or null prototype), as
 * opposed to an array, a class instance such as a Date, or a primitive.
 */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

/** Fields and expanded objects that one schema branch validates */
interface NestingGroup {
  fields: ResolvedFieldMeta[];
  nestedObjects?: NestedObjectInfo[] | undefined;
}

/** Args nested by one schema branch, to validate against the whole schema */
export interface NestingCandidate {
  args: Record<string, unknown>;
  /**
   * The union option the args were nested for. They are only valid when this
   * option accepts them too, as another option could accept them by
   * dropping values this nesting moved elsewhere.
   */
  branchSchema?: ArgsSchema | undefined;
  /**
   * Paths whose values were copied from an object default rather than
   * given. A default may hold output values that do not validate again as
   * input (e.g. after a transform), so issues only on these paths are not
   * the user's to fix.
   */
  defaultedPaths?: string[][] | undefined;
  /**
   * Set on the nesting by every branch at once, which is only for
   * reporting errors: no branch decided it, so it must not be accepted.
   * The message explains why it fails when it would otherwise pass.
   */
  diagnosticOnly?: { message: string } | undefined;
  /**
   * Paths of the values given on the command line (or from env), so a
   * failure can be ranked by how much of it is about them.
   */
  givenPaths?: string[][] | undefined;
  /**
   * The union options before this one, in schema order. A union takes the
   * first option that accepts its input, so one of these may accept the
   * args by dropping values this nesting gives.
   */
  precedingBranchSchemas?: ArgsSchema[] | undefined;
}

/**
 * The args to validate, with the values of nested leaves moved from their
 * flat `name` to their property path. Each candidate nests by one schema
 * branch that defines every given option, as branches may define the same
 * objects differently; validate them in order and keep the first that
 * passes.
 *
 * Within a branch, an object is created when one of its leaves has a value
 * or when it is required and its parent exists, so a missing value is
 * reported on the leaf option rather than on an object no option names. An
 * optional object without values stays absent so its own default (or
 * optionality) applies. An object that is created starts from its default,
 * so unspecified properties keep it; a second candidate starts it empty, for
 * defaults that do not validate as input.
 *
 * @param rawArgs - Parsed args keyed by field name
 * @param extracted - Extracted fields of the schema
 * @returns Candidates to validate; just `rawArgs` when nothing is nested
 */
export function nestingCandidates(
  rawArgs: Record<string, unknown>,
  extracted: ExtractedFields,
): NestingCandidate[] {
  const leafNames = new Set<string>();
  const objects = new Map<string, NestedObjectInfo>();
  const leaves = new Map<string, ResolvedFieldMeta>();
  const collect = (group: ExtractedFields): void => {
    for (const g of [group, ...(group.variants ?? [])]) {
      for (const field of g.fields) {
        if (!field.nested) continue;
        leafNames.add(field.name);
        if (!leaves.has(field.name)) leaves.set(field.name, field);
      }
      for (const object of g.nestedObjects ?? []) {
        const key = pathKey(object.path);
        if (!objects.has(key)) objects.set(key, object);
      }
    }
    for (const option of group.unionOptions ?? []) collect(option);
  };
  collect(extracted);
  if (objects.size === 0) return [{ args: rawArgs }];

  const nest = (group: NestingGroup, branchSchema?: ArgsSchema): NestingCandidate[] => {
    const seeded = nestGroup(rawArgs, group, leafNames, { createRequired: true, seed: true });
    const candidates: NestingCandidate[] = [{ ...seeded, branchSchema }];
    if (seeded.defaultedPaths.length > 0) {
      const empty = nestGroup(rawArgs, group, leafNames, { createRequired: true, seed: false });
      candidates.push({ ...empty, branchSchema });
    }
    return candidates;
  };
  if (!extracted.variants && !extracted.unionOptions) return nest(extracted);

  const branches = (
    group: ExtractedFields,
    schema: ArgsSchema | undefined,
  ): Array<{ group: NestingGroup; schema: ArgsSchema | undefined }> => {
    if (group.variants && group.discriminator) {
      const variant = selectVariant(rawArgs, group.discriminator, group.variants);
      return variant ? [{ group: variant, schema }] : [];
    }
    if (group.unionOptions) {
      return group.unionOptions.flatMap((option) => branches(option, option.schema));
    }
    return [{ group, schema }];
  };
  const all = branches(extracted, undefined);
  // A branch without one of the given options would drop its value.
  const given = [...leaves.values()].filter((leaf) => rawArgs[leaf.name] !== undefined);
  const givenPaths = [
    ...Object.keys(rawArgs)
      .filter((name) => !leafNames.has(name) && rawArgs[name] !== undefined)
      .map((name) => [name]),
    ...given.map((leaf) => leaf.nested!.path),
  ];
  const covering = all.filter(({ group }) => {
    const names = new Set(group.fields.map((field) => field.name));
    return given.every((leaf) => names.has(leaf.name));
  });
  // Every branch's leaves and objects, with no branch deciding which
  // required objects exist: reports errors when no branch fits.
  const merged = nestGroup(
    rawArgs,
    { fields: [...leaves.values()], nestedObjects: [...objects.values()] },
    leafNames,
    { createRequired: false, seed: true },
  );
  const options = given.map((leaf) => `--${leaf.cliName}`).join(", ");
  return [
    ...covering.flatMap((branch) => {
      const preceding = all
        .slice(0, all.indexOf(branch))
        .flatMap(({ schema }) => (schema && schema !== branch.schema ? [schema] : []));
      return nest(branch.group, branch.schema).map((candidate) => ({
        ...candidate,
        givenPaths,
        precedingBranchSchemas: [...new Set(preceding)],
      }));
    }),
    {
      ...merged,
      diagnosticOnly: {
        message: `No single schema option accepts ${options || "these arguments"}.`,
      },
    },
  ];
}

function pathKey(path: string[]): string {
  return path.join("\0");
}

/**
 * The discriminated-union variant that a discriminator value selects, by its
 * exact spelling first and then by its normalized value. Without a value,
 * the variant whose discriminator has a default, if exactly one does.
 */
function selectVariant(
  rawArgs: Record<string, unknown>,
  discriminator: string,
  variants: NonNullable<ExtractedFields["variants"]>,
): NonNullable<ExtractedFields["variants"]>[number] | undefined {
  const value = rawArgs[discriminator];
  if (value === undefined) {
    const defaulted = variants.filter(
      (v) => v.fields.find((f) => f.name === discriminator)?.defaultValue !== undefined,
    );
    return defaulted.length === 1 ? defaulted[0] : undefined;
  }
  return (
    variants.find((v) => String(value) === v.discriminatorValue) ??
    variants.find(
      (v) =>
        v.normalizeDiscriminator &&
        String(v.normalizeDiscriminator(value)) === v.discriminatorValue,
    )
  );
}

function nestGroup(
  rawArgs: Record<string, unknown>,
  group: NestingGroup,
  leafNames: ReadonlySet<string>,
  options: { createRequired: boolean; seed: boolean },
): { args: Record<string, unknown>; defaultedPaths: string[][] } {
  const result: Record<string, unknown> = { ...rawArgs };
  // Remove every flat name before building objects: a flat name may equal
  // the key of another object (`aB` from `a.b` next to an `aB` object). A
  // name another branch uses for a leaf stays when this group's own field
  // of that name is not nested.
  const ownFields = new Set(group.fields.filter((f) => !f.nested).map((f) => f.name));
  for (const name of leafNames) if (!ownFields.has(name)) delete result[name];

  const leaves = group.fields.filter((field) => field.nested && rawArgs[field.name] !== undefined);
  const present = new Set<string>();
  for (const leaf of leaves) {
    const path = leaf.nested!.path;
    for (let depth = 1; depth < path.length; depth++) present.add(pathKey(path.slice(0, depth)));
  }
  // Objects a given value lives in, as opposed to required ones created
  // only so a missing value is reported on its option.
  const opened = new Set(present);
  const objects = [...(group.nestedObjects ?? [])].sort((a, b) => a.path.length - b.path.length);
  if (options.createRequired) {
    for (const object of objects) {
      const parent = object.path.slice(0, -1);
      if (object.required && (parent.length === 0 || present.has(pathKey(parent)))) {
        present.add(pathKey(object.path));
      }
    }
  }

  const defaulted = new Map<string, string[]>();
  // Parents first, so every object is built inside an existing one.
  const kept = new Set<string>();
  for (const object of objects) {
    const objectKey = pathKey(object.path);
    if (!present.has(objectKey)) continue;
    const parentKey = pathKey(object.path.slice(0, -1));
    if (kept.has(parentKey)) {
      kept.add(objectKey);
      continue;
    }
    const parent = containerAt(result, object.path.slice(0, -1));
    const key = object.path[object.path.length - 1]!;
    const current = parent[key];
    // A required object without given values keeps a value its parent's
    // default gave it (such as `null` for a nullable object).
    if (!opened.has(objectKey) && current !== undefined && !isPlainObject(current)) {
      kept.add(objectKey);
      continue;
    }
    const base = isPlainObject(current)
      ? current
      : options.seed && isPlainObject(object.defaultValue)
        ? object.defaultValue
        : {};
    if (base === object.defaultValue) {
      for (const property of Object.keys(base)) {
        const path = [...object.path, property];
        defaulted.set(pathKey(path), path);
      }
    }
    // Copy so a shared default object is never mutated.
    parent[key] = { ...base };
  }
  for (const leaf of leaves) {
    const path = leaf.nested!.path;
    containerAt(result, path.slice(0, -1))[path[path.length - 1]!] = rawArgs[leaf.name];
    for (let depth = 1; depth <= path.length; depth++)
      defaulted.delete(pathKey(path.slice(0, depth)));
  }
  return { args: result, defaultedPaths: [...defaulted.values()] };
}

function containerAt(args: Record<string, unknown>, path: string[]): Record<string, unknown> {
  let target = args;
  for (const key of path) target = target[key] as Record<string, unknown>;
  return target;
}

/**
 * Read a field's value from validated (nested) args.
 */
export function getFieldValue(args: Record<string, unknown>, field: ResolvedFieldMeta): unknown {
  if (!field.nested) return args[field.name];
  let value: unknown = args;
  for (const key of field.nested.path) {
    // Any object, as a transform may turn an object into a class instance.
    value =
      typeof value === "object" && value !== null
        ? (value as Record<string, unknown>)[key]
        : undefined;
  }
  return value;
}

/**
 * Keys (see {@link nestedPathKey}) of every object expanded into options, in
 * any branch of the given extractions.
 */
export function nestedObjectPaths(...extractions: Array<ExtractedFields | undefined>): Set<string> {
  const paths = new Set<string>();
  const collect = (group: ExtractedFields): void => {
    for (const g of [group, ...(group.variants ?? [])]) {
      for (const object of g.nestedObjects ?? []) paths.add(pathKey(object.path));
    }
    for (const option of group.unionOptions ?? []) collect(option);
  };
  for (const extracted of extractions) if (extracted) collect(extracted);
  return paths;
}

/** The key {@link nestedObjectPaths} uses for a property path. */
export function nestedPathKey(path: string[]): string {
  return pathKey(path);
}

/**
 * Merge two values of an expanded object property by property, recursing
 * only into the objects `isObject` names; every other value (including an
 * option whose value is itself an object) is replaced by `override`'s.
 *
 * @param path - Property path of `base` and `override`
 */
export function mergeNestedValues(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
  isObject: (path: string[]) => boolean,
  path: string[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    const childPath = [...path, key];
    merged[key] =
      isObject(childPath) && isPlainObject(current) && isPlainObject(value)
        ? mergeNestedValues(current, value, isObject, childPath)
        : value;
  }
  return merged;
}
