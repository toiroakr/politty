import type { ArgMeta, ArgsSchema, InferSchemaOutput, SchemaLike } from "@politty/core";
import {
  resolveFieldMeta,
  type ExtractedFields,
  type FieldIntrospection,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "@politty/core/adapter/field-meta";
import type { ValidatorAdapter } from "@politty/core/adapter/types";
import {
  assertDeclaredKeys,
  getUnflattenOptions,
  pathResolver,
  registerUnflatten,
  rejectUnflattenedOption,
  unflattenRecord,
  type Unflatten,
  type UnflattenOptions,
} from "@politty/core/adapter/unflatten";
import { getArgMeta } from "@politty/core/core/arg-registry";
import {
  optionsDefineFieldsDifferently,
  selectDiscriminatedVariant,
} from "@politty/core/core/schema-extractor";

export interface StandardJSONSchema {
  readonly "~standard": {
    readonly version: 1;
    readonly jsonSchema: {
      input(options: { target: "draft-2020-12" }): Record<string, unknown>;
    };
  };
}

export type StandardArgsSchema<
  Output extends InferSchemaOutput<ArgsSchema> = InferSchemaOutput<ArgsSchema>,
> = SchemaLike<Output> & StandardJSONSchema;

type SchemaInput<S extends ArgsSchema> =
  NonNullable<S["~standard"]["types"]> extends {
    readonly input: infer Input;
  }
    ? Input
    : unknown;

export type StandardFieldMetadata<Value = unknown> = ArgMeta<Value> & {
  type?: ResolvedFieldMeta["type"];
  choices?: readonly string[];
  required?: boolean;
  defaultValue?: unknown;
};

type FieldSetting<Value> = StandardFieldMetadata<Value> | SchemaLike;

type SchemaOutput<S extends ArgsSchema> =
  unknown extends InferSchemaOutput<S> ? Record<string, unknown> : InferSchemaOutput<S>;

type ArgFields<Input, Output> = {
  [Key in keyof Input]?: FieldSetting<Key extends keyof Output ? Output[Key] : unknown>;
};

type Tag = string | number | boolean;

export interface StandardDiscriminator {
  field: string;
  values: readonly (Tag | readonly Tag[])[];
}

export interface StandardArgsOptions<Input = Record<string, unknown>, Output = Input> {
  fields?: ArgFields<Input extends object ? Input : Record<string, unknown>, Output>;
  unknownKeys?: UnknownKeysMode;
  discriminator?: string | StandardDiscriminator;
  branches?: readonly ArgsSchema[];
}

const overrides = new WeakMap<ArgsSchema, StandardArgsOptions>();

export function standardArgs<S extends StandardArgsSchema>(
  schema: S,
  options?: StandardArgsOptions<SchemaInput<S>, SchemaOutput<S>>,
): StandardArgsSchema<SchemaOutput<S>>;
export function standardArgs<S extends ArgsSchema>(
  schema: S,
  options: StandardArgsOptions<SchemaInput<S>, SchemaOutput<S>> & {
    jsonSchema: StandardJSONSchema;
  },
): StandardArgsSchema<SchemaOutput<S>>;
export function standardArgs<S extends ArgsSchema>(
  schema: S,
  options?: StandardArgsOptions<SchemaInput<S>, SchemaOutput<S>> & {
    jsonSchema?: StandardJSONSchema;
  },
): StandardArgsSchema<SchemaOutput<S>> {
  const converter = options?.jsonSchema ?? schema;
  const jsonSchema = getConverter(converter);
  const original = schema["~standard"];
  const wrapped: StandardArgsSchema<SchemaOutput<S>> = {
    "~standard": {
      version: original.version,
      vendor: original.vendor,
      validate: (value: unknown) => original.validate(value),
      jsonSchema,
    },
  };
  const previous = overrides.get(schema);
  const fields = options?.fields as StandardArgsOptions["fields"];
  const unknownKeys = options?.unknownKeys ?? previous?.unknownKeys;
  const discriminator = options?.discriminator ?? previous?.discriminator;
  const branches = options?.branches ?? previous?.branches;
  overrides.set(wrapped, {
    ...((previous?.fields || fields) && { fields: { ...previous?.fields, ...fields } }),
    ...(unknownKeys && { unknownKeys }),
    ...(discriminator !== undefined && { discriminator }),
    ...(branches && { branches: [...branches] }),
  });
  const nesting = getUnflattenOptions(schema);
  return nesting ? registerUnflatten(wrapped, nesting) : wrapped;
}

export function unflatten<S extends StandardArgsSchema>(
  schema: S,
): StandardArgsSchema<Unflatten<InferSchemaOutput<S>>>;
export function unflatten<S extends StandardArgsSchema, const O extends UnflattenOptions>(
  schema: S,
  options: O,
): StandardArgsSchema<Unflatten<InferSchemaOutput<S>, O>>;
export function unflatten(
  schema: StandardArgsSchema,
  options: UnflattenOptions = {},
): StandardArgsSchema {
  const extracted = extractFields(schema);
  if (extracted.schemaType !== "object" || getUnflattenOptions(schema)) {
    throw new TypeError("politty/standard unflatten requires a flat object schema.");
  }
  const pathOf = pathResolver(options);
  assertDeclaredKeys(
    extracted.fields.map(({ name }) => name),
    options,
  );
  const original = schema["~standard"];
  const nested: StandardArgsSchema = {
    "~standard": {
      version: original.version,
      vendor: original.vendor,
      jsonSchema: original.jsonSchema,
      validate(value) {
        const result = validateSync(schema, value);
        return result.issues
          ? result
          : unflattenRecord(result.value as Record<string, unknown>, pathOf);
      },
    },
  };
  const metadata = overrides.get(schema);
  if (metadata) overrides.set(nested, metadata);
  cache.set(nested, { ...extracted, schema: nested });
  return registerUnflatten(nested, options);
}

const standaloneFields = new WeakMap<
  object,
  {
    converter: StandardJSONSchema["~standard"]["jsonSchema"];
    required: boolean;
    metadata: ArgMeta | undefined;
  }
>();

export function standardField<S extends SchemaLike & StandardJSONSchema>(
  schema: S,
  options: { required: boolean },
): SchemaLike<InferSchemaOutput<S>>;
export function standardField<S extends SchemaLike>(
  schema: S,
  options: { required: boolean; jsonSchema: StandardJSONSchema },
): SchemaLike<InferSchemaOutput<S>>;
export function standardField(
  schema: SchemaLike,
  options: { required: boolean; jsonSchema?: StandardJSONSchema },
): SchemaLike {
  const field = { "~standard": schema["~standard"] };
  standaloneFields.set(field, {
    converter: getConverter(options.jsonSchema ?? schema),
    required: options.required,
    metadata: getArgMeta(schema),
  });
  return field;
}

function getConverter(
  schema: SchemaLike | StandardJSONSchema,
): StandardJSONSchema["~standard"]["jsonSchema"] {
  const standard = schema?.["~standard"];
  if (
    standard?.version === 1 &&
    "jsonSchema" in standard &&
    typeof standard.jsonSchema?.input === "function"
  ) {
    return standard.jsonSchema;
  }
  throw new Error(
    "politty/standard requires an input JSON Schema converter. Pass one to standardArgs(schema, { jsonSchema }).",
  );
}

type JsonSchema = Record<string, unknown>;

function asObject(value: unknown): JsonSchema | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonSchema)
    : undefined;
}

function own(object: JsonSchema, key: string): unknown {
  return Object.hasOwn(object, key) ? object[key] : undefined;
}

function resolveReference(value: unknown, root: JsonSchema, seen = new Set<string>()): JsonSchema {
  const node = asObject(value) ?? {};
  const reference = node.$ref;
  if (typeof reference !== "string") return node;
  const hasStructuralSiblings = [
    "type",
    "properties",
    "required",
    "additionalProperties",
    "unevaluatedProperties",
    "anyOf",
    "oneOf",
    "allOf",
    "enum",
    "const",
  ].some((key) => Object.hasOwn(node, key));
  if (
    (reference !== "#" && !reference.startsWith("#/")) ||
    seen.has(reference) ||
    hasStructuralSiblings
  ) {
    throw new Error(`politty/standard cannot inspect JSON Schema reference "${reference}".`);
  }
  seen.add(reference);
  const pointer = reference === "#" ? [] : decodeURIComponent(reference.slice(2)).split("/");
  const target = pointer.reduce<unknown>((current, token) => {
    const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
    if (Array.isArray(current)) {
      return /^(0|[1-9][0-9]*)$/.test(key) && Object.hasOwn(current, key)
        ? current[Number(key)]
        : undefined;
    }
    const object = asObject(current);
    return object ? own(object, key) : undefined;
  }, root);
  if (target === undefined) {
    throw new Error(`politty/standard cannot resolve JSON Schema reference "${reference}".`);
  }
  const resolved = resolveReference(target, root, seen);
  const { description, default: defaultValue } = node;
  return {
    ...resolved,
    ...(typeof description === "string" && { description }),
    ...(Object.hasOwn(node, "default") && { default: defaultValue }),
  };
}

type FieldShape = {
  type: ResolvedFieldMeta["type"] | "null";
  enumValues?: string[] | undefined;
  tags?: Tag[] | undefined;
  itemChoices?: string[] | undefined;
  description?: string | undefined;
  defaultValue?: unknown;
};

function commonFieldType(types: readonly unknown[]): FieldShape["type"] {
  const nonNull = new Set(
    types.filter((type) => type !== "null").map((type) => (type === "integer" ? "number" : type)),
  );
  if (nonNull.size === 0 && types.length > 0) return "null";
  if (nonNull.size === 1) {
    const type = nonNull.values().next().value;
    if (type === "string" || type === "number" || type === "boolean" || type === "array") {
      return type;
    }
  }
  return "unknown";
}

function fieldShape(
  value: unknown,
  root: JsonSchema,
  ancestors: readonly unknown[] = [],
): FieldShape {
  if (ancestors.includes(value)) return { type: "unknown" };
  const node = resolveReference(value, root);
  const literals: unknown[] = Object.hasOwn(node, "const")
    ? [node.const]
    : Array.isArray(node.enum)
      ? node.enum
      : [];
  const intersection = Array.isArray(node.allOf);
  const choices = node.anyOf ?? node.oneOf ?? node.allOf;
  const parents = [...ancestors, value];
  const children = Array.isArray(choices)
    ? choices.map((choice) => fieldShape(choice, root, parents))
    : [];
  const types = Array.isArray(node.type)
    ? node.type
    : node.type !== undefined
      ? [node.type]
      : literals.length
        ? literals.map((literal) => {
            if (literal === null) return "null";
            return Array.isArray(literal) ? "array" : typeof literal;
          })
        : children.map((child) => child.type).filter((type) => !intersection || type !== "unknown");
  const type = commonFieldType(types);
  const nonNullChildren = children.filter(({ type }) => type !== "null");
  const nonNullLiterals = literals.filter((literal) => literal !== null);
  const literalChoices =
    nonNullLiterals.length && nonNullLiterals.every(isTag)
      ? nonNullLiterals.map(String)
      : undefined;
  const childChoices = nonNullChildren.flatMap((child) =>
    child.enumValues ? [child.enumValues] : [],
  );
  const enumValues = intersection
    ? intersectChoices(literalChoices ? [literalChoices, ...childChoices] : childChoices)
    : (literalChoices ??
      (childChoices.length > 0 && childChoices.length === nonNullChildren.length
        ? [...new Set(childChoices.flat())]
        : undefined));
  const directTags = literals.length && literals.every(isTag) ? literals : undefined;
  const childTags = children.flatMap((child) => (child.tags ? [child.tags] : []));
  const tags = intersection
    ? intersectChoices(directTags ? [directTags, ...childTags] : childTags)
    : (directTags ??
      (childTags.length > 0 && childTags.length === children.length
        ? childTags.flat()
        : undefined));
  const directItems = asObject(node.items) && fieldShape(node.items, root, parents).enumValues;
  const childItems = children.flatMap((child) => (child.itemChoices ? [child.itemChoices] : []));
  const itemChoices = intersection
    ? intersectChoices(directItems ? [directItems, ...childItems] : childItems)
    : (directItems ??
      (childItems.length > 0 && childItems.length === children.length
        ? [...new Set(childItems.flat())]
        : undefined));
  const soleChild = nonNullChildren.length === 1 ? nonNullChildren[0] : undefined;
  return {
    type,
    tags,
    itemChoices,
    enumValues: (type === "array" ? itemChoices : undefined) ?? enumValues,
    description: typeof node.description === "string" ? node.description : soleChild?.description,
    defaultValue: Object.hasOwn(node, "default") ? node.default : soleChild?.defaultValue,
  };
}

type StandardFieldIntrospection = FieldIntrospection & Pick<FieldShape, "tags">;
const fieldIntrospection = new WeakMap<object, StandardFieldIntrospection>();

function withFieldIntrospection(
  field: ResolvedFieldMeta,
  changes: Partial<Omit<StandardFieldIntrospection, "schema">>,
): ResolvedFieldMeta {
  const previous = fieldIntrospection.get(field.schema as object)!;
  const schema = { ...(field.schema as JsonSchema) };
  const introspection = { ...previous, ...changes, schema };
  fieldIntrospection.set(schema, introspection);
  return resolveFieldMeta(field.name, introspection);
}

function fieldMeta(
  name: string,
  node: JsonSchema,
  required: boolean,
  root: JsonSchema,
  setting?: FieldSetting<unknown>,
): ResolvedFieldMeta {
  const shape = fieldShape(node, root);
  const schema = { ...node };
  const fieldSchema = setting && "~standard" in setting ? setting : undefined;
  const metadata = setting && !("~standard" in setting) ? setting : undefined;
  const standalone = fieldSchema && standaloneFields.get(fieldSchema);
  const argMeta = fieldSchema ? (getArgMeta(fieldSchema) ?? standalone?.metadata) : metadata;
  const introspection: StandardFieldIntrospection = {
    argMeta,
    required: metadata?.required ?? standalone?.required ?? required,
    type: metadata?.type ?? (shape.type === "null" ? "unknown" : shape.type),
    schema,
    tags: shape.tags,
    description: shape.description,
    defaultValue:
      metadata && Object.hasOwn(metadata, "defaultValue")
        ? metadata.defaultValue
        : shape.defaultValue,
    enumValues: metadata?.choices ? [...metadata.choices] : shape.enumValues,
  };
  fieldIntrospection.set(schema, introspection);
  return resolveFieldMeta(name, introspection);
}

function hasPatternProperties(node: JsonSchema): boolean {
  return Object.keys(asObject(node.patternProperties) ?? {}).length > 0;
}

function mayEvaluateUnknownKeys(
  node: JsonSchema,
  root: JsonSchema,
  visited: Set<unknown>,
): boolean {
  if (
    (node.additionalProperties !== undefined && node.additionalProperties !== false) ||
    hasPatternProperties(node) ||
    node.if !== undefined ||
    node.dependentSchemas !== undefined
  ) {
    return true;
  }
  return [node.allOf, node.anyOf, node.oneOf].some(
    (branches) =>
      Array.isArray(branches) &&
      branches.some((branch) => {
        if (visited.has(branch)) return false;
        visited.add(branch);
        return mayEvaluateUnknownKeys(resolveReference(branch, root), root, visited);
      }),
  );
}

function rejectsUnknownKeys(node: JsonSchema, root: JsonSchema): boolean {
  return (
    (node.additionalProperties === false && !hasPatternProperties(node)) ||
    (node.unevaluatedProperties === false && !mayEvaluateUnknownKeys(node, root, new Set([node])))
  );
}

function extractObject(
  node: JsonSchema,
  root: JsonSchema,
  schema: ArgsSchema,
  options: StandardArgsOptions | undefined,
  required: ReadonlySet<unknown>,
): ExtractedFields {
  if (
    (node.type !== "object" && !(node.type === undefined && asObject(node.properties))) ||
    node.allOf !== undefined ||
    node.anyOf !== undefined ||
    node.oneOf !== undefined
  ) {
    throw new Error(
      "politty/standard expects an input JSON Schema with an object shape or a tagged union of objects.",
    );
  }
  const fields = Object.entries(asObject(node.properties) ?? {}).map(([name, property]) =>
    fieldMeta(
      name,
      resolveReference(property, root),
      required.has(name),
      root,
      options?.fields && Object.hasOwn(options.fields, name) ? options.fields[name] : undefined,
    ),
  );
  return {
    schemaType: "object",
    schema,
    fields,
    unknownKeysMode: options?.unknownKeys ?? (rejectsUnknownKeys(node, root) ? "strict" : "strip"),
    ...(typeof node.description === "string" && { description: node.description }),
  };
}

function branchMode(
  node: JsonSchema,
  root: JsonSchema,
  branches: ExtractedFields[],
  override?: UnknownKeysMode,
): UnknownKeysMode {
  if (override !== undefined) return override;
  if (rejectsUnknownKeys(node, root)) return "strict";
  const modes = new Set(branches.map((branch) => branch.unknownKeysMode));
  return modes.size === 1 ? branches[0]!.unknownKeysMode : "strip";
}

function combinedFields(branches: readonly { fields: ResolvedFieldMeta[] }[]): ResolvedFieldMeta[] {
  const fields = new Map<string, ResolvedFieldMeta>();
  for (const branch of branches) {
    for (const field of branch.fields) {
      if (!fields.has(field.name)) fields.set(field.name, field);
    }
  }
  return [...fields.values()];
}

function isTag(value: unknown): value is Tag {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function intersectChoices<Value>(choices: Value[][]): Value[] | undefined {
  const [first, ...rest] = choices;
  return first?.filter((value) => rest.every((other) => other.includes(value)));
}

function tagsOf(field: ResolvedFieldMeta): Tag[] {
  return [...new Set(fieldIntrospection.get(field.schema as object)?.tags)];
}

function normalizeTag(value: unknown, tag: Tag): unknown {
  if (typeof value !== "string") return value;
  if (typeof tag === "number" && /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) {
    return Number(value);
  }
  if (typeof tag === "boolean") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return value;
}

function taggedUnion(branches: ExtractedFields[], requested: StandardArgsOptions["discriminator"]) {
  const tags = branches.map(
    (branch) =>
      new Map(
        branch.fields
          .filter(({ required }) => required)
          .map((field) => [field.name, tagsOf(field)]),
      ),
  );
  const requestedName = typeof requested === "object" ? requested.field : requested;
  const explicit = typeof requested === "object" ? requested.values : undefined;
  if (explicit && explicit.length !== branches.length) {
    throw new Error(
      "politty/standard discriminator values must match the number and order of the union branches.",
    );
  }
  for (const name of requestedName === undefined ? (tags[0]?.keys() ?? []) : [requestedName]) {
    const values = tags.map((tag, index) => {
      if (!explicit) return tag.get(name) ?? [];
      if (!tag.has(name)) return [];
      const value = explicit[index];
      if (isTag(value)) return [value];
      return value ?? [];
    });
    if (values.some((group) => !group.length || !group.every(isTag))) continue;
    const spellings = values.flat().map(String);
    if (new Set(spellings).size !== spellings.length) continue;
    const kinds = new Set(values.flat().map((value) => typeof value));
    const variants = branches.flatMap((branch, index) => {
      const fields = branch.fields.map((field) =>
        field.name === name
          ? withFieldIntrospection(field, {
              type: kinds.size === 1 ? field.type : "unknown",
              enumValues: spellings,
            })
          : field,
      );
      return values[index]!.map((tag) => ({
        discriminatorValue: String(tag),
        normalizeDiscriminator: (value: unknown) => normalizeTag(value, tag),
        fields,
        ...(branch.description !== undefined && { description: branch.description }),
      }));
    });
    return { discriminator: name, variants };
  }
  if (requestedName !== undefined) {
    throw new Error(
      `politty/standard discriminator "${requestedName}" requires distinct literal choices in every branch.`,
    );
  }
  return undefined;
}

function intersectFields(branches: ExtractedFields[]): ResolvedFieldMeta[] {
  const fields = new Map<string, ResolvedFieldMeta>();
  for (const branch of branches) {
    for (const next of branch.fields) {
      const previous = fields.get(next.name);
      if (!previous) {
        fields.set(next.name, next);
        continue;
      }
      if (previous.type !== "unknown" && next.type !== "unknown" && previous.type !== next.type) {
        throw new Error(
          `politty/standard intersection has incompatible CLI types for "${next.name}". Set its field type explicitly.`,
        );
      }
      if (previous.effect && next.effect && previous.effect !== next.effect) {
        throw new Error(
          `politty/standard intersection has multiple effects for "${next.name}". Register one effect for the field.`,
        );
      }
      const left = fieldIntrospection.get(previous.schema as object)!;
      const right = fieldIntrospection.get(next.schema as object)!;
      fields.set(
        next.name,
        withFieldIntrospection(previous, {
          argMeta:
            left.argMeta && right.argMeta
              ? { ...right.argMeta, ...left.argMeta }
              : (left.argMeta ?? right.argMeta),
          description: left.description ?? right.description,
          defaultValue: left.defaultValue === undefined ? right.defaultValue : left.defaultValue,
          type: previous.type === "unknown" ? next.type : previous.type,
          required: previous.required || next.required,
          enumValues: intersectChoices(
            [previous.enumValues, next.enumValues].filter((choices) => choices !== undefined),
          ),
        }),
      );
    }
  }
  return [...fields.values()];
}

function assertConfiguredFields(extracted: ExtractedFields, options?: StandardArgsOptions): void {
  for (const name of Object.keys(options?.fields ?? {})) {
    if (!extracted.fields.some((field) => field.name === name)) {
      throw new Error(`politty/standard has CLI metadata for an unknown argument "${name}".`);
    }
  }
}

function extractNode(
  value: unknown,
  root: JsonSchema,
  schema: ArgsSchema,
  options: StandardArgsOptions | undefined,
  ancestors: readonly unknown[] = [],
  inheritedRequired: ReadonlySet<unknown> = new Set(),
): ExtractedFields {
  if (ancestors.includes(value)) {
    throw new Error("politty/standard cannot extract a recursive argument composition.");
  }
  const node = resolveReference(value, root);
  const required = Array.isArray(node.required)
    ? new Set([...inheritedRequired, ...node.required])
    : inheritedRequired;
  const composition = (["anyOf", "oneOf", "allOf"] as const).filter((key) =>
    Object.hasOwn(node, key),
  );
  if (composition.length === 0) {
    if (options?.branches || options?.discriminator !== undefined) {
      throw new Error("politty/standard branch metadata requires a union or intersection.");
    }
    return extractObject(node, root, schema, options, required);
  }
  const keyword = composition[0]!;
  const choices = node[keyword];
  if (
    composition.length !== 1 ||
    !Array.isArray(choices) ||
    choices.length === 0 ||
    (keyword !== "allOf" && node.properties !== undefined)
  ) {
    throw new Error(
      "politty/standard expects a single object composition at each argument schema level.",
    );
  }
  if (
    options?.branches &&
    (options.branches.length !== choices.length ||
      Array.from(options.branches).some((branch) => !branch))
  ) {
    throw new Error(
      "politty/standard branches must match the number and order of the JSON Schema alternatives.",
    );
  }

  const parents = [...ancestors, value];
  const branches = choices.map((choice, index) => {
    const branch = options?.branches?.[index];
    if (branch) rejectUnflattenedOption(branch);
    const branchOptions = branch && overrides.get(branch);
    const inherited: StandardArgsOptions = {
      ...branchOptions,
      fields: { ...options?.fields, ...branchOptions?.fields },
    };
    const extracted = extractNode(choice, root, branch ?? schema, inherited, parents, required);
    assertConfiguredFields(extracted, branchOptions);
    if (branch) cache.set(branch, extracted);
    return extracted;
  });
  if (keyword === "allOf" && node.properties !== undefined) {
    const { allOf: _branches, ...object } = node;
    branches.unshift(extractObject(object, root, schema, options, required));
  }
  const common = {
    schema,
    unknownKeysMode: branchMode(node, root, branches, options?.unknownKeys),
    ...(typeof node.description === "string" && { description: node.description }),
  };
  if (keyword === "allOf") {
    if (
      branches.some(
        (branch) => branch.schemaType !== "object" && branch.schemaType !== "intersection",
      )
    ) {
      throw new Error("politty/standard intersections require object branches.");
    }
    if (options?.discriminator !== undefined) {
      throw new Error("politty/standard discriminator metadata requires a union.");
    }
    return {
      ...common,
      fields: intersectFields(branches),
      schemaType: "intersection",
    };
  }
  const tagged = branches.every((branch) => branch.schemaType === "object")
    ? taggedUnion(branches, options?.discriminator)
    : undefined;
  if (tagged) {
    return {
      ...common,
      ...tagged,
      fields: combinedFields(tagged.variants),
      schemaType: "discriminatedUnion",
    };
  }
  if (options?.discriminator !== undefined) {
    throw new Error("politty/standard discriminator metadata requires object branches.");
  }
  if (!options?.branches && optionsDefineFieldsDifferently(branches)) {
    throw new Error(
      "politty/standard requires branch validators for a union with branch-specific effects or package requirements. Pass them in standardArgs({ ... }, { branches }).",
    );
  }
  return {
    ...common,
    fields: combinedFields(branches),
    schemaType: keyword === "anyOf" ? "union" : "xor",
    unionOptions: branches,
  };
}

const cache = new WeakMap<ArgsSchema, ExtractedFields>();

function extractFields(schema: ArgsSchema): ExtractedFields {
  const cached = cache.get(schema);
  if (cached) return cached;
  const converter = getConverter(schema);
  let root: JsonSchema;
  try {
    root = converter.input({ target: "draft-2020-12" });
  } catch (cause) {
    throw new Error(
      "politty/standard could not convert the arguments to an input JSON Schema (draft-2020-12).",
      { cause },
    );
  }
  const options = overrides.get(schema);
  const extracted = extractNode(root, root, schema, options);
  assertConfiguredFields(extracted, options);
  cache.set(schema, extracted);
  return extracted;
}

type StandardValidation =
  | { value: unknown; issues?: undefined }
  | {
      issues: ReadonlyArray<{
        message: string;
        path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
      }>;
    };

function validateSync(schema: SchemaLike, value: unknown): StandardValidation {
  const result = schema["~standard"].validate(value) as
    | StandardValidation
    | Promise<StandardValidation>;
  if ("then" in result) {
    void Promise.resolve(result).catch(() => undefined);
    throw new Error(
      "politty/standard requires a synchronous Standard Schema validator, but validate() returned a Promise. Use a synchronous validator, or check the schema definition if the validator reports its own errors asynchronously.",
    );
  }
  return result;
}

function normalizeDiscriminator(
  raw: Record<string, unknown>,
  extracted: ExtractedFields | undefined,
): Record<string, unknown> {
  if (!extracted) return raw;
  const name = extracted.discriminator;
  if (name === undefined) {
    const candidates = extracted.unionOptions?.filter((option) => {
      const selected = selectDiscriminatedVariant(option, () => raw);
      if (option.discriminator && selected === option) return false;
      const fields = new Set(selected.fields.map((field) => field.name));
      return (
        selected.fields.every((field) => !field.required || raw[field.name] !== undefined) &&
        !extracted.fields.some((field) => raw[field.name] !== undefined && !fields.has(field.name))
      );
    });
    return candidates?.length === 1 ? normalizeDiscriminator(raw, candidates[0]) : raw;
  }
  if (typeof raw[name] !== "string") return raw;
  const value = raw[name];
  const candidates = extracted.variants ?? [];
  const selected =
    candidates.find((variant) => variant.discriminatorValue === value) ??
    candidates.find(
      (variant) => String(variant.normalizeDiscriminator?.(value)) === variant.discriminatorValue,
    );
  const normalized = selected?.normalizeDiscriminator?.(value) ?? value;
  return normalized === value ? raw : { ...raw, [name]: normalized };
}

export const standardAdapter: ValidatorAdapter = {
  vendor: "standard",
  extractFields,
  getUnknownKeysMode: (schema) => extractFields(schema).unknownKeysMode,
  resolveFieldMeta(name, schema) {
    const node = asObject(schema);
    const introspection = node && fieldIntrospection.get(node);
    if (introspection) return resolveFieldMeta(name, introspection);
    const field = node && standaloneFields.get(node);
    if (field) {
      const root = field.converter.input({ target: "draft-2020-12" });
      const metadata = getArgMeta(node) ?? field.metadata;
      return fieldMeta(name, resolveReference(root, root), field.required, root, metadata);
    }
    throw new Error(
      "politty/standard requires the enclosing object schema for documentation fields. Pass the schema as globalArgs to generateDoc(), or use standardField() with explicit requiredness.",
    );
  },
  validate(rawArgs, schema) {
    const result = validateSync(schema, normalizeDiscriminator(rawArgs, cache.get(schema)));
    if (!result.issues) return { success: true, data: result.value };
    return {
      success: false,
      errors: result.issues.map(({ message, path }) => ({
        code: "custom",
        message,
        path:
          path?.map((segment) => String(typeof segment === "object" ? segment.key : segment)) ?? [],
      })),
    };
  },
};
