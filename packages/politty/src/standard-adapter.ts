import type { ArgMeta, ArgsSchema, InferSchemaOutput, SchemaLike } from "@politty/core";
import {
  resolveFieldMeta,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "@politty/core/adapter/field-meta";
import type { ValidatorAdapter } from "@politty/core/adapter/types";

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

export interface StandardArgsOptions<Output = Record<string, unknown>> {
  fields?: { [Key in keyof Output]?: ArgMeta<Output[Key]> };
  unknownKeys?: UnknownKeysMode;
}

const overrides = new WeakMap<ArgsSchema, StandardArgsOptions>();

export function standardArgs<S extends StandardArgsSchema>(
  schema: S,
  options?: StandardArgsOptions<InferSchemaOutput<S>>,
): StandardArgsSchema<InferSchemaOutput<S>>;
export function standardArgs<S extends ArgsSchema>(
  schema: S,
  options: StandardArgsOptions<InferSchemaOutput<S>> & { jsonSchema: StandardJSONSchema },
): StandardArgsSchema<InferSchemaOutput<S>>;
export function standardArgs<S extends ArgsSchema>(
  schema: S,
  options?: StandardArgsOptions<InferSchemaOutput<S>> & { jsonSchema?: StandardJSONSchema },
): StandardArgsSchema<InferSchemaOutput<S>> {
  const converter = options?.jsonSchema ?? schema;
  const jsonSchema = getConverter(converter);
  const original = schema["~standard"];
  const wrapped: StandardArgsSchema<InferSchemaOutput<S>> = {
    "~standard": {
      version: original.version,
      vendor: original.vendor,
      validate: (value: unknown) => original.validate(value),
      jsonSchema,
    },
  };
  if (options) {
    overrides.set(wrapped, {
      ...(options.fields && {
        fields: { ...options.fields } as NonNullable<StandardArgsOptions["fields"]>,
      }),
      ...(options.unknownKeys && { unknownKeys: options.unknownKeys }),
    });
  }
  return wrapped;
}

function getConverter(
  schema: ArgsSchema | StandardJSONSchema,
): StandardJSONSchema["~standard"]["jsonSchema"] {
  const standard = schema["~standard"];
  if (
    standard.version === 1 &&
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
    "anyOf",
    "oneOf",
    "allOf",
    "enum",
    "const",
  ].some((key) => Object.hasOwn(node, key));
  if (!reference.startsWith("#/") || seen.has(reference) || hasStructuralSiblings) {
    throw new Error(`politty/standard cannot inspect JSON Schema reference "${reference}".`);
  }
  seen.add(reference);
  const target = decodeURIComponent(reference.slice(2))
    .split("/")
    .reduce<unknown>((current, token) => {
      const object = asObject(current);
      const key = token.replaceAll("~1", "/").replaceAll("~0", "~");
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

function getLiterals(node: JsonSchema): unknown[] {
  if (Object.hasOwn(node, "const")) return [node.const];
  return Array.isArray(node.enum) ? node.enum.filter((value) => value !== null) : [];
}

function fieldMeta(
  name: string,
  node: JsonSchema,
  required: boolean,
  root: JsonSchema,
  argMeta?: ArgMeta,
): ResolvedFieldMeta {
  let shape = node;
  const choices = node.anyOf ?? node.oneOf;
  if (Array.isArray(choices) && choices.length === 2) {
    const resolved = choices.map((choice) => resolveReference(choice, root));
    const nonNull = resolved.filter((choice) => choice.type !== "null" && choice.const !== null);
    if (nonNull.length === 1) shape = nonNull[0]!;
  }
  const types = Array.isArray(shape.type)
    ? shape.type.filter((type) => type !== "null")
    : [shape.type];
  const literals = getLiterals(shape);
  const enumValues =
    literals.length && literals.every((value) => typeof value === "string") ? literals : undefined;
  const literalTypes = new Set(literals.map((value) => typeof value));
  const inferredType =
    types.length === 1
      ? (types[0] ?? (literalTypes.size === 1 ? typeof literals[0] : undefined))
      : undefined;
  const description = node.description ?? shape.description;

  return resolveFieldMeta(name, {
    argMeta,
    description: typeof description === "string" ? description : undefined,
    required,
    defaultValue: Object.hasOwn(node, "default") ? node.default : shape.default,
    type:
      inferredType === "integer"
        ? "number"
        : inferredType === "string" ||
            inferredType === "number" ||
            inferredType === "boolean" ||
            inferredType === "array"
          ? inferredType
          : "unknown",
    enumValues,
    schema: node,
  });
}

function extractObject(
  node: JsonSchema,
  root: JsonSchema,
  schema: ArgsSchema,
  options: StandardArgsOptions | undefined,
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
  const required = new Set(Array.isArray(node.required) ? node.required : []);
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
    unknownKeysMode:
      options?.unknownKeys ?? (node.additionalProperties === false ? "strict" : "strip"),
    ...(typeof node.description === "string" && { description: node.description }),
  };
}

function extractTaggedUnion(
  node: JsonSchema,
  choices: unknown[],
  root: JsonSchema,
  schema: ArgsSchema,
  options: StandardArgsOptions | undefined,
): ExtractedFields {
  const branches = choices.map((choice) =>
    extractObject(resolveReference(choice, root), root, schema, options),
  );
  const tags = branches.map(({ fields }) => {
    const tagsByField = new Map<string, string>();
    for (const field of fields) {
      const property = field.schema as JsonSchema;
      const tag =
        property.const ??
        (Array.isArray(property.enum) && property.enum.length === 1 ? property.enum[0] : undefined);
      if (field.required && typeof tag === "string") tagsByField.set(field.name, tag);
    }
    return tagsByField;
  });
  const discriminator = [...(tags[0]?.keys() ?? [])].find((name) => {
    const values = tags.map((tag) => tag.get(name));
    return !values.includes(undefined) && new Set(values).size === values.length;
  });
  if (
    branches.length < 2 ||
    !discriminator ||
    node.properties !== undefined ||
    node.allOf !== undefined
  ) {
    throw new Error(
      "politty/standard expects each union branch to have a distinct string tag in a shared required field.",
    );
  }
  const fields = new Map<string, ResolvedFieldMeta>();
  for (const branch of branches) {
    for (const field of branch.fields) {
      if (!fields.has(field.name)) fields.set(field.name, field);
    }
  }
  return {
    schemaType: "discriminatedUnion",
    schema,
    fields: [...fields.values()],
    discriminator,
    variants: branches.map((branch, index) => ({
      discriminatorValue: tags[index]!.get(discriminator)!,
      fields: branch.fields,
      ...(branch.description !== undefined && { description: branch.description }),
    })),
    unknownKeysMode:
      options?.unknownKeys ??
      (node.additionalProperties === false ||
      branches.every((branch) => branch.unknownKeysMode === "strict")
        ? "strict"
        : "strip"),
    ...(typeof node.description === "string" && { description: node.description }),
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
  const node = resolveReference(root, root);
  const options = overrides.get(schema);
  const choices = node.anyOf ?? node.oneOf;
  const extracted = Array.isArray(choices)
    ? extractTaggedUnion(node, choices, root, schema, options)
    : extractObject(node, root, schema, options);
  for (const name of Object.keys(options?.fields ?? {})) {
    if (!extracted.fields.some((field) => field.name === name)) {
      throw new Error(`politty/standard has CLI metadata for an unknown argument "${name}".`);
    }
  }
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

export const standardAdapter: ValidatorAdapter = {
  vendor: "standard",
  extractFields,
  getUnknownKeysMode: (schema) => extractFields(schema).unknownKeysMode,
  resolveFieldMeta(name, schema) {
    const root = getConverter(schema as StandardArgsSchema).input({ target: "draft-2020-12" });
    return fieldMeta(name, resolveReference(root, root), false, root);
  },
  validate(rawArgs, schema) {
    const result = schema["~standard"].validate(rawArgs) as
      | StandardValidation
      | Promise<StandardValidation>;
    if ("then" in result) {
      void Promise.resolve(result).catch(() => undefined);
      throw new Error("politty/standard requires a synchronous Standard Schema validator.");
    }
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
