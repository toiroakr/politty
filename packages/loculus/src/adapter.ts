import {
  addIntersectionField,
  resolveFieldMeta,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "@politty/core/adapter/field-meta";
import type { ValidatorAdapter } from "@politty/core/adapter/types";
import { getArgMeta, type ArgMeta } from "@politty/core/core/arg-registry";
import type { ArgsSchema } from "@politty/core/types";
import { boolean, intersection, number, union, xor, type AnySchema, type Meta } from "loculus";

function metadata(schema: AnySchema): ArgMeta | undefined {
  const own = getArgMeta(schema);
  return own ?? (schema.meta.inner ? metadata(schema.meta.inner) : undefined);
}
function resolve(name: string, schema: AnySchema): ResolvedFieldMeta {
  const meta = schema.meta;
  return resolveFieldMeta(name, {
    argMeta: metadata(schema),
    description: meta.description,
    required: !meta.optional,
    defaultValue: meta.defaultValue,
    type:
      meta.kind === "date"
        ? "string"
        : ["string", "number", "boolean", "array"].includes(meta.kind)
          ? (meta.kind as ResolvedFieldMeta["type"])
          : "unknown",
    enumValues: (meta.enumValues ?? meta.literalValues)?.map(String),
    schema,
    objectShape: objectShape(schema),
    objectTransformed: transformsObject(schema),
  });
}
// `inner` is a wrapped schema, or an array's element schema: an array of
// objects is no object.
function objectShape(schema: AnySchema): Record<string, AnySchema> | undefined {
  const { meta } = schema;
  if (meta.kind === "array") return undefined;
  return meta.shape ?? (meta.inner ? objectShape(meta.inner) : undefined);
}
// `transform` wraps a schema as `inner` without keeping the object's own
// `shape` property, which `refine` keeps along with everything else.
function transformsObject(schema: AnySchema): boolean {
  const { meta } = schema;
  if (meta.kind === "array" || !meta.inner) return false;
  return !("shape" in schema) || transformsObject(meta.inner);
}
function mode(meta: Meta): UnknownKeysMode {
  return meta.unknownKeys ?? "strip";
}
const cache = new WeakMap<ArgsSchema, ExtractedFields>();
export function extractLoculusFields(schema: ArgsSchema): ExtractedFields {
  const cached = cache.get(schema);
  if (cached) return cached;
  const concrete = schema as AnySchema;
  const meta = concrete.meta;
  let result: ExtractedFields;
  if (meta.shape) {
    result = {
      fields: Object.entries(meta.shape).map(([name, field]) => resolve(name, field)),
      schema,
      schemaType: "object",
      unknownKeysMode: mode(meta),
    };
  } else if (meta.options) {
    const options = meta.options.map((option) => extractLoculusFields(option as ArgsSchema));
    const unknownKeysMode = options[0]?.unknownKeysMode ?? "strip";
    const fields = new Map<string, ResolvedFieldMeta>();
    for (const option of options)
      for (const field of option.fields)
        if (meta.kind === "intersection") addIntersectionField(fields, field);
        else if (!fields.has(field.name)) fields.set(field.name, field);
    result = {
      fields: [...fields.values()],
      schema,
      schemaType: meta.discriminator
        ? "discriminatedUnion"
        : (meta.kind as "union" | "xor" | "intersection"),
      unknownKeysMode: options.every((option) => option.unknownKeysMode === unknownKeysMode)
        ? unknownKeysMode
        : "strip",
    };
    if (meta.discriminator) {
      const key = meta.discriminator;
      const types = new Set(
        options.map((option) => option.fields.find((field) => field.name === key)?.type),
      );
      const discriminatorType = types.size === 1 ? [...types][0]! : "unknown";
      const fieldsFor = (fields: ResolvedFieldMeta[]) =>
        fields.map((field) => (field.name === key ? { ...field, type: discriminatorType } : field));
      result.fields = fieldsFor(result.fields);
      const spellings = new Map<string, number>();
      result.discriminator = key;
      result.variants = options.flatMap((option, i) => {
        const discriminatorMeta = meta.options![i]!.meta.shape?.[key]?.meta;
        const values = discriminatorMeta?.enumValues ?? discriminatorMeta?.literalValues ?? [];
        return [...new Set(values)].map((discriminatorValue) => {
          const spelling = String(discriminatorValue);
          const previous = spellings.get(spelling);
          if (previous !== undefined && previous !== i)
            throw new TypeError(`Ambiguous CLI discriminator: ${key}=${spelling}`);
          spellings.set(spelling, i);
          return {
            discriminatorValue: spelling,
            normalizeDiscriminator: (value: unknown) => normalizeLiteral(value, discriminatorMeta!),
            fields: fieldsFor(option.fields),
            ...(option.description ? { description: option.description } : {}),
          };
        });
      });
    } else if (meta.kind !== "intersection") result.unionOptions = options;
  } else throw new TypeError("loculus command arguments must have object output");
  if (meta.description) result.description = meta.description;
  cache.set(schema, result);
  return result;
}
const discriminatorValidators = {
  number: number()["~standard"].validate,
  boolean: boolean()["~standard"].validate,
};
function normalizeLiteral(value: unknown, meta: Meta): unknown {
  if (
    typeof value !== "string" ||
    meta.enumValues?.includes(value) ||
    meta.literalValues?.includes(value)
  )
    return value;
  for (const literal of meta.literalValues ?? []) {
    const kind = typeof literal;
    if (kind !== "number" && kind !== "boolean") continue;
    const result = discriminatorValidators[kind](value);
    if (!result.issues && result.value === literal) return result.value;
  }
  return value;
}
function normalizeDiscriminator(
  raw: Record<string, unknown>,
  schema: AnySchema,
): Record<string, unknown> {
  const key = schema.meta.discriminator;
  if (!key || typeof raw[key] !== "string") return raw;
  const fields = (schema.meta.options ?? []).map((option) => option.meta.shape?.[key]);
  const value = raw[key] as string;
  if (
    fields.some(
      (field) =>
        field?.meta.enumValues?.includes(value) || field?.meta.literalValues?.includes(value),
    )
  )
    return raw;
  for (const field of fields) {
    const literal = field?.meta.literalValues?.find((literal) => String(literal) === value);
    if (literal !== undefined) return { ...raw, [key]: literal };
  }
  for (const field of fields) {
    if (!field) continue;
    const normalized = normalizeLiteral(value, field.meta);
    if (normalized !== value) return { ...raw, [key]: normalized };
  }
  return raw;
}
const validators = new WeakMap<AnySchema, AnySchema["~standard"]["validate"]>();
function validatorFor(schema: AnySchema): AnySchema["~standard"]["validate"] {
  const cached = validators.get(schema);
  if (cached) return cached;
  let validate = schema["~standard"].validate;
  const { meta } = schema;
  if (
    meta.discriminator &&
    meta.options?.some((option) =>
      option.meta.shape?.[meta.discriminator!]?.meta.literalValues?.some(
        (value) => typeof value !== "string",
      ),
    )
  ) {
    validate = (raw) => {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return schema["~standard"].validate(raw);
      return schema["~standard"].validate(
        normalizeDiscriminator(raw as Record<string, unknown>, schema),
      );
    };
  } else if (meta.options && !meta.inner) {
    const options = meta.options.map((option) => ({
      ...option,
      "~standard": { ...option["~standard"], validate: validatorFor(option) },
    }));
    if (
      options.some(
        (option, i) => option["~standard"].validate !== meta.options![i]!["~standard"].validate,
      )
    ) {
      if (meta.kind === "intersection")
        validate = intersection(options[0]!, options[1]!)["~standard"].validate;
      else if (meta.kind === "union" || meta.kind === "xor") {
        const branches = options as [AnySchema, AnySchema, ...AnySchema[]];
        validate = (meta.kind === "union" ? union(branches) : xor(branches))["~standard"].validate;
      }
    }
  }
  validators.set(schema, validate);
  return validate;
}
export const loculusAdapter: ValidatorAdapter = {
  vendor: "loculus",
  extractFields: extractLoculusFields,
  resolveFieldMeta: (name, schema) => resolve(name, schema as AnySchema),
  getUnknownKeysMode: (schema) => extractLoculusFields(schema).unknownKeysMode,
  validate: (raw, schema) => {
    const concrete = schema as AnySchema;
    const result = validatorFor(concrete)(raw);
    return result.issues
      ? {
          success: false,
          errors: result.issues.map((issue) => ({
            path: (issue.path ?? []).map((segment) =>
              String(typeof segment === "object" ? segment.key : segment),
            ),
            message: issue.message,
            code: issue.code ?? "invalid_value",
          })),
        }
      : { success: true, data: result.value };
  },
};
