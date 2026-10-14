import {
  resolveFieldMeta,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "@politty/core/adapter/field-meta";
import type { ValidatorAdapter } from "@politty/core/adapter/types";
import { getArgMeta, type ArgMeta } from "@politty/core/core/arg-registry";
import type { ArgsSchema } from "@politty/core/types";
import { boolean, number, type AnySchema, type Meta } from "loculus";

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
  });
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
      for (const field of option.fields) if (!fields.has(field.name)) fields.set(field.name, field);
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
      result.discriminator = key;
      result.variants = options.flatMap((option, i) => {
        const discriminatorMeta = meta.options![i]!.meta.shape?.[key]?.meta;
        const values = discriminatorMeta?.enumValues ?? discriminatorMeta?.literalValues ?? [];
        return values.map((discriminatorValue) => ({
          discriminatorValue: String(discriminatorValue),
          fields: option.fields,
          ...(option.description ? { description: option.description } : {}),
        }));
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
    for (const literal of field?.meta.literalValues ?? []) {
      const kind = typeof literal;
      if (kind !== "number" && kind !== "boolean") continue;
      const result = discriminatorValidators[kind](value);
      if (!result.issues && result.value === literal) {
        return { ...raw, [key]: result.value };
      }
    }
  }
  return raw;
}
export const loculusAdapter: ValidatorAdapter = {
  vendor: "loculus",
  extractFields: extractLoculusFields,
  resolveFieldMeta: (name, schema) => resolve(name, schema as AnySchema),
  getUnknownKeysMode: (schema) => extractLoculusFields(schema).unknownKeysMode,
  validate: (raw, schema) => {
    const concrete = schema as AnySchema;
    const result = concrete["~standard"].validate(normalizeDiscriminator(raw, concrete));
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
