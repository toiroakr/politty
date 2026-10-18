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
  // An intersection keeps only its union members' combined fields, which
  // take the first branch's definition of an object.
  const unionObject = extracted.unionMembers?.map(firstObjectField).find(Boolean);
  if (unionObject) {
    throw new Error(
      `Object field "${unionObject}" of a union inside an intersection cannot be expanded into options: move the fields the intersection adds into each union option instead.`,
    );
  }
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
  // Then whatever only later branches define, scalar or leaf.
  for (const branch of branches) for (const field of branch.fields) add(field);
  return {
    ...extracted,
    fields,
    nestedObjects: branches.flatMap((branch) => branch.nestedObjects ?? []),
    ...(flatVariants && { variants: flatVariants }),
    ...(flatOptions && { unionOptions: flatOptions }),
  };
}

/** The name of the first object field in any branch of an extraction */
function firstObjectField(extracted: ExtractedFields): string | undefined {
  const field = [extracted, ...(extracted.variants ?? [])]
    .flatMap((group) => group.fields)
    .find((f) => f.objectShape);
  return field?.name ?? (extracted.unionOptions ?? []).map(firstObjectField).find(Boolean);
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
    names: { name: string; cliName: string; kebab: string },
    inherited: {
      style: NestedKeyStyle;
      description: string | undefined;
      /** The nearest enclosing object (or this one) a transform may replace */
      transformed: string[] | undefined;
    },
    enclosingRequired: boolean,
  ): void => {
    const unsupported = UNSUPPORTED_OBJECT_META.filter((key) => Boolean(object[key]));
    if (unsupported.length > 0) {
      throw new Error(
        `Invalid arg() metadata for object field "${path.join(".")}": ${unsupported.join(", ")} cannot be used on object fields (set them on its properties instead).`,
      );
    }
    // Its options are built and defaulted property by property; an object
    // default would have to be merged into given values on every branch.
    if (object.defaultValue !== undefined) {
      throw new Error(
        `Object field "${path.join(".")}" cannot have a default value: set defaults on its properties instead. A required object is created from its properties' defaults when no option is given.`,
      );
    }
    nestedObjects.push({
      path,
      required: object.required,
      passthrough: object.objectUnknownKeys === "passthrough",
    });
    const style = object.flatten ?? inherited.style;
    const description = object.description ?? inherited.description;
    const transformed = object.objectTransformed ? path : inherited.transformed;
    // A camelCase parent prefix keeps camelCase all the way down.
    const cliPrefix = style === "camel" && path.length === 1 ? names.name : names.cliName;
    // Whether this object, and so every enclosing one, must be present.
    const required = enclosingRequired && object.required;

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
      // The kebab-case spelling is built key by key: one rebuilt from a
      // camelCase name loses the boundary after a digit (`s3Region`).
      const kebab = `${names.kebab}${style === "dot" ? "." : "-"}${toKebabCase(key)}`;

      if (child.objectShape) {
        walk(
          child,
          childPath,
          { name, cliName, kebab },
          { style, description, transformed },
          required,
        );
        continue;
      }

      // An effect and package requirements read their property's value,
      // which a transform of an enclosing object may replace or reshape.
      const valueMeta = (["effect", "requiredPackages"] as const).filter((key) => child[key]);
      if (valueMeta.length > 0 && transformed) {
        throw new Error(
          `Property "${childPath.join(".")}" cannot have ${valueMeta.map((key) => (key === "effect" ? "an effect" : key)).join(" or ")}: its object "${transformed.join(".")}" has a transform, which may change the value. Use the transformed value elsewhere, or move the transform onto the property.`,
        );
      }

      // Runtime reads `--no-` followed by a lowercase name, so a non-camel
      // negation spells out a camelCase prefix in kebab-case.
      const negationDisplay =
        child.negation === true
          ? style === "camel"
            ? // From the camelCase form the parser registers: `noHTTPConfig`
              // would be read as `hTTPConfig`.
              `no${capitalize(toCamelCase(kebab))}`
            : `no-${kebab}`
          : child.negationDisplay;
      // Like every other option, accept both the kebab-case and camelCase
      // forms (hidden from help). The parser derives camelCase from `name`,
      // which keeps an acronym (`baseURL`), so the camelCase form of the
      // kebab-case spelling (`baseUrl`) is added too.
      const spellings = [kebab, toCamelCase(kebab)].filter(
        (spelling) => spelling !== cliName && spelling !== name,
      );
      const hiddenAlias =
        spellings.length === 0
          ? child.hiddenAlias
          : [...new Set([...(child.hiddenAlias ?? []), ...spellings])];
      leaves.push({
        ...child,
        name,
        cliName,
        hiddenAlias,
        // Without a description of its own, an option describes its object.
        description: child.description ?? description,
        // Name the value after the property, not the whole option path.
        placeholder: child.placeholder ?? toKebabCase(key).toUpperCase(),
        required: required && child.required,
        negationDisplay,
        nested: { path: childPath },
      });
    }
  };
  walk(
    root,
    [root.name],
    { name: root.name, cliName: root.cliName, kebab: toKebabCase(root.cliName) },
    { style: "dot", description: undefined, transformed: undefined },
    true,
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
export interface NestingGroup {
  fields: ResolvedFieldMeta[];
  nestedObjects?: NestedObjectInfo[] | undefined;
}

/** A union option that precedes the one a candidate nests by */
export interface PrecedingBranch {
  /**
   * The option and the union options enclosing it, outermost first: the
   * union takes it only when every one of them accepts the args
   */
  schemas: ArgsSchema[];
  /** The option's fields and expanded objects */
  group: NestingGroup;
  /**
   * Keys (see {@link nestedPathKey}) of the paths the option's fields hold
   * values at: a leaf's property path, else the field name
   */
  paths: ReadonlySet<string>;
  /** Keys of the objects the option expands, to whether each keeps unknown keys */
  objects: ReadonlyMap<string, boolean>;
  /** Whether the option keeps top-level keys it does not define */
  passthrough: boolean;
}

/**
 * What a union option does with a given value when it accepts the args: it
 * keeps a value at a path one of its fields holds, and drops one under a
 * key its enclosing object (or the option itself) does not define unless
 * that object keeps unknown keys. A value kept as an unknown key is only
 * `"retained"`: what the object keeps it as (a typed catchall validates it
 * in turn) is not known here.
 *
 * @param branch - The option that accepts the args
 * @param path - Property path of the given value
 */
export function givenValueFate(
  branch: Pick<PrecedingBranch, "paths" | "objects" | "passthrough">,
  path: string[],
): { fate: "kept" | "dropped" } | { fate: "retained"; container: string[] } {
  for (let depth = 1; depth <= path.length; depth++) {
    const key = pathKey(path.slice(0, depth));
    // A field holding the value itself keeps it; one holding an enclosing
    // object (such as a record) may still drop it below, like a catchall.
    if (branch.paths.has(key)) {
      return depth === path.length
        ? { fate: "kept" }
        : { fate: "retained", container: path.slice(0, depth - 1) };
    }
    if (branch.objects.has(key)) continue;
    // The object (or option) keeping the value as an unknown key.
    const container = path.slice(0, depth - 1);
    const keepsUnknown =
      container.length === 0
        ? branch.passthrough
        : (branch.objects.get(pathKey(container)) ?? false);
    return keepsUnknown ? { fate: "retained", container } : { fate: "dropped" };
  }
  return { fate: "kept" };
}

/** Args nested by one schema branch, to validate against the whole schema */
export interface NestingCandidate {
  args: Record<string, unknown>;
  /** The branch whose fields and objects nested the args */
  group?: NestingGroup | undefined;
  /**
   * The union option the args were nested for. They are only valid when this
   * option accepts them too, as another option could accept them by
   * dropping values this nesting moved elsewhere.
   */
  branchSchema?: ArgsSchema | undefined;
  /**
   * The union options enclosing `branchSchema`, outermost first and ending
   * with it: the union takes the branch only when every one accepts
   */
  branchSchemas?: ArgsSchema[] | undefined;
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
   * args by dropping given values it does not define.
   */
  precedingBranches?: PrecedingBranch[] | undefined;
  /** The given values, by field name and property path */
  given?: Array<{ name: string; path: string[] }> | undefined;
  /**
   * What the branch keeps (see {@link givenValueFate}): it may take given
   * values it does not define only as unknown keys
   */
  retention?: Pick<PrecedingBranch, "paths" | "objects" | "passthrough"> | undefined;
  /**
   * Paths of another option's given values that a plain union option could
   * not place, as a value given for the same property took their place: it
   * would lose them, so it must not accept the args.
   */
  unplaced?: string[][] | undefined;
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
 * reported on the leaf option rather than on an object no option names, and
 * its properties' defaults apply. An optional object without values stays
 * absent. (Expanded objects have no defaults of their own.)
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

  const nest = (
    group: NestingGroup,
    branchSchema?: ArgsSchema,
    createRequired: CreateRequired = true,
    foreign: ResolvedFieldMeta[] = [],
  ): NestingCandidate[] => {
    const unplaced: string[][] = [];
    const args = nestGroup(rawArgs, group, leafNames, { createRequired, foreign, unplaced });
    return [{ args, group, branchSchema, ...(unplaced.length > 0 && { unplaced }) }];
  };
  if (!extracted.variants && !extracted.unionOptions) return nest(extracted);

  interface Branch {
    group: NestingGroup;
    schema: ArgsSchema | undefined;
    /** The union options enclosing this branch, outermost first, ending with `schema` */
    schemas: ArgsSchema[];
    names: ReadonlySet<string>;
    paths: ReadonlySet<string>;
    objects: ReadonlyMap<string, boolean>;
    /** An option of a plain union, which takes the first option that fits */
    plain: boolean;
    passthrough: boolean;
  }
  const branches = (group: ExtractedFields, schemas: ArgsSchema[], plain: boolean): Branch[] => {
    const branch = (
      fields: NestingGroup & { retainsUnknownKeys?: boolean | undefined },
    ): Branch => ({
      group: fields,
      schema: schemas.at(-1),
      schemas,
      names: new Set(fields.fields.map((field) => field.name)),
      paths: new Set(fields.fields.map((field) => pathKey(field.nested?.path ?? [field.name]))),
      objects: new Map(
        (fields.nestedObjects ?? []).map((object) => [pathKey(object.path), !!object.passthrough]),
      ),
      plain,
      // A variant keeps unknown keys by its own policy.
      passthrough:
        fields.retainsUnknownKeys ??
        (group.unknownKeysMode === "passthrough" || !!group.retainsUnknownKeys),
    });
    if (group.variants && group.discriminator) {
      const variant = selectVariant(rawArgs, group.discriminator, group.variants);
      return variant ? [branch(variant)] : [];
    }
    if (group.unionOptions) {
      return group.unionOptions.flatMap((option) =>
        branches(option, [...schemas, option.schema], true),
      );
    }
    return [branch(group)];
  };
  const all = branches(extracted, [], false);
  // The given values of fields some branch defines.
  const known = new Map<string, ResolvedFieldMeta>();
  for (const { group } of all) {
    for (const field of group.fields) if (!known.has(field.name)) known.set(field.name, field);
  }
  for (const [name, leaf] of leaves) if (!known.has(name)) known.set(name, leaf);
  const givenFields = [...known.values()].filter((field) => isGiven(rawArgs, field.name));
  const givenPaths = [
    ...Object.keys(rawArgs)
      .filter((name) => !known.has(name) && rawArgs[name] !== undefined)
      .map((name) => [name]),
    ...givenFields.map((field) => field.nested?.path ?? [field.name]),
  ];
  // A plain union option without one of the given options would drop its
  // value: a nested leaf is never placed, and a value it does not define is
  // stripped. A discriminated union's variant treats the options of other
  // variants like any unknown option, by its own unknown-key policy.
  const covering = all.filter((branch) =>
    givenFields.every(
      (field) =>
        branch.names.has(field.name) ||
        !branch.plain ||
        (field.nested
          ? givenValueFate(branch, field.nested.path).fate !== "dropped"
          : branch.passthrough),
    ),
  );
  // Every branch's leaves and objects, with no branch deciding which
  // required objects exist: reports errors when no branch fits.
  const merged = nestGroup(
    rawArgs,
    { fields: [...leaves.values()], nestedObjects: [...objects.values()] },
    leafNames,
    { createRequired: false },
  );
  const options = givenFields.map((field) => `--${field.cliName}`).join(", ");
  const nestBranch = (branch: Branch, createRequired: CreateRequired): NestingCandidate[] => {
    const preceding = all
      .slice(0, all.indexOf(branch))
      .filter((earlier) => earlier.schema && earlier.schema !== branch.schema);
    // Where this branch puts each given value, which another branch may
    // define elsewhere under the same name.
    const own = new Map(branch.group.fields.map((field) => [field.name, field]));
    const given = givenFields.map((field) => {
      const defined = own.get(field.name) ?? field;
      return { name: field.name, path: defined.nested?.path ?? [defined.name] };
    });
    // Another variant's given leaves, placed at their path for this
    // variant's policy to strip, keep or reject.
    const foreign = givenFields.filter((field) => field.nested && !branch.names.has(field.name));
    return nest(branch.group, branch.schema, createRequired, foreign).map((candidate) => ({
      ...candidate,
      branchSchemas: branch.schemas,
      retention: branch,
      // A variant leaves them to its unknown-key policy instead.
      unplaced: branch.plain ? candidate.unplaced : undefined,
      givenPaths,
      given,
      precedingBranches: preceding.map(({ schemas, group, paths, objects, passthrough }) => ({
        schemas,
        group,
        paths,
        objects,
        passthrough,
      })),
    }));
  };
  // A plain union option is taken as a whole, so first create its required
  // objects only inside an object a given value opened: otherwise an option
  // would be chosen for values that never named it. Only when no option
  // fits that way, create them all, so their defaults apply.
  const plain = covering.filter((branch) => branch.plain);
  return [
    ...covering.flatMap((branch) => nestBranch(branch, branch.plain ? "opened" : true)),
    ...plain.flatMap((branch) => nestBranch(branch, true)),
    {
      args: merged,
      diagnosticOnly: {
        message: `No single schema option accepts ${options || "these arguments"}.`,
      },
    },
  ];
}

/**
 * Which required objects to create: all of them, only those inside an
 * object a given value opened (`"opened"`), or none.
 */
type CreateRequired = boolean | "opened";

/** Whether a value was given under a name: an inherited `toString` is none */
function isGiven(rawArgs: Record<string, unknown>, name: string): boolean {
  return Object.hasOwn(rawArgs, name) && rawArgs[name] !== undefined;
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
    // A variant listed once per allowed value counts only for the value
    // its discriminator defaults to.
    const defaulted = variants.filter((v) => {
      const defaultValue = v.fields.find((f) => f.name === discriminator)?.defaultValue;
      return defaultValue !== undefined && String(defaultValue) === v.discriminatorValue;
    });
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
  options: {
    createRequired: CreateRequired;
    foreign?: ResolvedFieldMeta[];
    /** Collects the paths of foreign leaves that could not be placed */
    unplaced?: string[][];
  },
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rawArgs };
  // Remove every flat name before building objects: a flat name may equal
  // the key of another object (`aB` from `a.b` next to an `aB` object). A
  // name another branch uses for a leaf stays when this group's own field
  // of that name is not nested.
  const ownFields = new Set(group.fields.filter((f) => !f.nested).map((f) => f.name));
  for (const name of leafNames) if (!ownFields.has(name)) delete result[name];

  const leaves = group.fields.filter((field) => field.nested && isGiven(rawArgs, field.name));
  const present = new Set<string>();
  // Another variant's leaves open this variant's objects along their path
  // too, so their required objects are created as well.
  for (const leaf of [...leaves, ...(options.foreign ?? [])]) {
    const path = leaf.nested!.path;
    for (let depth = 1; depth < path.length; depth++) present.add(pathKey(path.slice(0, depth)));
  }
  const objects = [...(group.nestedObjects ?? [])].sort((a, b) => a.path.length - b.path.length);
  if (options.createRequired) {
    for (const object of objects) {
      const parent = object.path.slice(0, -1);
      const inside =
        parent.length === 0 ? options.createRequired === true : present.has(pathKey(parent));
      if (object.required && inside) {
        present.add(pathKey(object.path));
      }
    }
  }

  // Parents first, so every object is built inside an existing one.
  for (const object of objects) {
    if (!present.has(pathKey(object.path))) continue;
    const parent = containerAt(result, object.path.slice(0, -1));
    // Only the diagnostic nesting of every branch at once can place an
    // object inside another branch's leaf value; leave such paths out.
    if (!parent) continue;
    const key = object.path[object.path.length - 1]!;
    // An own property only: `constructor` is no value given.
    const current = Object.hasOwn(parent, key) ? parent[key] : undefined;
    // A value given in its place that is no object is the schema's to
    // reject, not to be replaced.
    if (current !== undefined && !isPlainObject(current)) continue;
    // Copy so a value given as a whole is never mutated.
    setOwn(parent, key, isPlainObject(current) ? { ...current } : {});
  }
  for (const leaf of leaves) {
    const path = leaf.nested!.path;
    const container = containerAt(result, path.slice(0, -1));
    if (container) setOwn(container, path[path.length - 1]!, rawArgs[leaf.name]);
  }
  // One that cannot be placed stays under its flat name, for the schema's
  // unknown-key policy to handle rather than vanishing.
  for (const leaf of options.foreign ?? []) {
    if (placeAt(result, leaf.nested!.path, rawArgs[leaf.name])) continue;
    result[leaf.name] = rawArgs[leaf.name];
    options.unplaced?.push(leaf.nested!.path);
  }
  return result;
}

/**
 * Set a value at a property path, creating the objects along it (and copying
 * existing ones), unless the path is taken or runs through a value that is
 * no plain object.
 *
 * @returns Whether the value was set
 */
/**
 * Set an own data property, also for a key such as `__proto__`, which an
 * assignment would pass to the inherited setter
 */
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function placeAt(args: Record<string, unknown>, path: string[], value: unknown): boolean {
  // Check before writing, so a value that cannot be placed changes nothing.
  let probe: unknown = args;
  for (let depth = 1; depth <= path.length; depth++) {
    const key = path[depth - 1]!;
    const next = isPlainObject(probe) && Object.hasOwn(probe, key) ? probe[key] : undefined;
    if (next === undefined) break;
    if (depth === path.length || !isPlainObject(next)) return false;
    probe = next;
  }
  let target = args;
  for (const key of path.slice(0, -1)) {
    const next = Object.hasOwn(target, key) ? target[key] : undefined;
    const copy = isPlainObject(next) ? { ...next } : {};
    setOwn(target, key, copy);
    target = copy;
  }
  setOwn(target, path[path.length - 1]!, value);
  return true;
}

function containerAt(
  args: Record<string, unknown>,
  path: string[],
): Record<string, unknown> | undefined {
  let target: unknown = args;
  for (const key of path) {
    if (!isPlainObject(target) || !Object.hasOwn(target, key)) return undefined;
    target = target[key];
  }
  return isPlainObject(target) ? target : undefined;
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
 * Keys (see {@link nestedPathKey}) of the objects expanded into options,
 * including empty ones. Pass the extraction narrowed to the branch actually
 * used, so an object only another branch expands is not mistaken for one.
 */
export function nestedObjectPaths(extracted: ExtractedFields | undefined): Set<string> {
  const paths = new Set<string>();
  for (const object of extracted?.nestedObjects ?? []) paths.add(pathKey(object.path));
  for (const field of extracted?.fields ?? []) {
    const path = field.nested?.path ?? [];
    for (let depth = 1; depth < path.length; depth++) paths.add(pathKey(path.slice(0, depth)));
  }
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
    setOwn(
      merged,
      key,
      isObject(childPath) && isPlainObject(current) && isPlainObject(value)
        ? mergeNestedValues(current, value, isObject, childPath)
        : value,
    );
  }
  return merged;
}
