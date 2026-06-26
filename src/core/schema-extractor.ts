import type { z } from "zod";
import type { AnyCommand, ArgsSchema } from "../types.js";
import { validateStandard } from "../validator/standard-validator.js";
import { getArgMeta as getArgMetaFromRegistry, type ArgMeta } from "./arg-registry.js";
import {
  buildFieldMeta,
  getAllAliases,
  toCamelCase,
  toKebabCase,
  type DerivedFieldInfo,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "./field-meta.js";
import type { InternalSchema } from "./internal-schema.js";
import {
  registerSchemaAdapter,
  resolveSchemaAdapter,
  type SchemaAdapter,
} from "./schema-registry.js";
import {
  getChildSchema,
  getJsonSchema,
  getUnionOptionSchemas,
  prepareSchema,
  unwrapStandardSchema,
  type JsonSchema,
} from "./standard-schema.js";

// Re-export the shared field-metadata model so existing importers of these
// names from "./schema-extractor.js" (and from "politty") keep working.
export {
  buildFieldMeta,
  getAllAliases,
  toCamelCase,
  toKebabCase,
  type DerivedFieldInfo,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
};

// ---------------------------------------------------------------------------
// JSON Schema extraction backend (non-Zod Standard Schema vendors)
// ---------------------------------------------------------------------------

/**
 * Detect the base field type from a JSON Schema property.
 * Enums of string values are treated as "string".
 */
function jsonBaseType(prop: JsonSchema): "string" | "number" | "boolean" | "array" | "unknown" {
  if (
    Array.isArray(prop.enum) &&
    prop.enum.length > 0 &&
    prop.enum.every((v) => typeof v === "string")
  ) {
    return "string";
  }
  let t = prop.type;
  if (Array.isArray(t)) {
    t = t.find((x) => x !== "null");
  }
  switch (t) {
    case "string":
      return "string";
    case "number":
    case "integer":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    default:
      if (typeof prop.const === "string") return "string";
      return "unknown";
  }
}

/**
 * Extract string enum values from a JSON Schema property (including arrays of
 * enums). Returns undefined when not a string enum.
 */
function jsonEnumValues(prop: JsonSchema): string[] | undefined {
  if (Array.isArray(prop.enum) && prop.enum.length > 0) {
    const strings = prop.enum.filter((v): v is string => typeof v === "string");
    if (strings.length === prop.enum.length) return strings;
  }
  if (prop.type === "array" && prop.items && !Array.isArray(prop.items)) {
    return jsonEnumValues(prop.items);
  }
  return undefined;
}

/**
 * Map JSON Schema `additionalProperties` to politty's unknown-keys mode.
 * - `false` → "strict"
 * - `true` / object → "passthrough"
 * - absent → "strip" (default)
 */
function jsonUnknownKeysMode(json: JsonSchema): UnknownKeysMode {
  const ap = json.additionalProperties;
  if (ap === false) return "strict";
  if (ap === true || (ap && typeof ap === "object")) return "passthrough";
  return "strip";
}

/**
 * Resolve field metadata for a single JSON Schema property, recovering `arg()`
 * metadata from the original child sub-schema by reference where available.
 */
function resolveFieldMetaFromJson(
  rootSchema: object,
  name: string,
  prop: JsonSchema,
  required: boolean,
): ResolvedFieldMeta {
  const child = getChildSchema(rootSchema, name);
  let argMeta: ArgMeta | undefined;
  // ArkType `Type` instances are callable (typeof === "function"); both
  // functions and objects are valid WeakMap keys, so accept either.
  if (child && (typeof child === "object" || typeof child === "function")) {
    argMeta =
      getArgMetaFromRegistry(child as object) ??
      getArgMetaFromRegistry(unwrapStandardSchema(child) as object);
  }

  return buildFieldMeta(name, argMeta, {
    description: prop.description,
    type: jsonBaseType(prop),
    required: required && prop.default === undefined,
    defaultValue: prop.default,
    enumValues: jsonEnumValues(prop),
    // `schema` is only consumed by Zod-specific docs tooling; expose the
    // original child (or root) reference for completeness.
    schema: (child ?? rootSchema) as z.ZodType,
  });
}

/**
 * Read a single-valued string discriminant from a JSON Schema property,
 * accepting both `const: "x"` and single-entry `enum: ["x"]` encodings (which
 * different converters emit for literal fields).
 */
function jsonConstString(prop: JsonSchema | undefined): string | undefined {
  if (!prop) return undefined;
  if (typeof prop.const === "string") return prop.const;
  if (Array.isArray(prop.enum) && prop.enum.length === 1 && typeof prop.enum[0] === "string") {
    return prop.enum[0];
  }
  return undefined;
}

/**
 * Detect a discriminator across union branches: a property present in every
 * branch as a distinct string literal. Mirrors Zod's discriminatedUnion so
 * non-Zod discriminated unions get variant-aware help/docs/prompting. Returns
 * the discriminator key plus each branch's value (aligned to `branches` order).
 */
function detectJsonDiscriminator(
  branches: JsonSchema[],
): { discriminator: string; values: string[] } | undefined {
  if (branches.length < 2) return undefined;
  const firstProps = branches[0]?.properties;
  if (!firstProps) return undefined;
  for (const key of Object.keys(firstProps)) {
    const values: string[] = [];
    let ok = true;
    for (const branch of branches) {
      const value = jsonConstString(branch.properties?.[key]);
      if (value === undefined) {
        ok = false;
        break;
      }
      values.push(value);
    }
    if (ok && new Set(values).size === values.length) {
      return { discriminator: key, values };
    }
  }
  return undefined;
}

/**
 * Resolve the fields of a single object-shaped JSON Schema branch. `metaRoot`
 * is the original sub-schema used to recover `arg()` metadata by reference
 * (undefined when the vendor does not expose branch sub-schemas).
 */
function extractObjectBranchFields(branch: JsonSchema, metaRoot: unknown): ResolvedFieldMeta[] {
  const properties = branch.properties ?? {};
  const requiredSet = new Set(branch.required ?? []);
  return Object.entries(properties).map(([name, prop]) =>
    resolveFieldMetaFromJson((metaRoot ?? {}) as object, name, prop, requiredSet.has(name)),
  );
}

/** Merge branch field lists into a deduped list (first occurrence wins). */
function mergeBranchFields(branchFields: ResolvedFieldMeta[][]): ResolvedFieldMeta[] {
  const merged = new Map<string, ResolvedFieldMeta>();
  for (const fields of branchFields) {
    for (const field of fields) {
      if (!merged.has(field.name)) merged.set(field.name, field);
    }
  }
  return Array.from(merged.values());
}

/**
 * Extract fields from a non-Zod Standard Schema by converting it to JSON Schema.
 *
 * Object schemas map directly; composite schemas are recognized from JSON
 * Schema combinators so they reach parity with the Zod path:
 * - `allOf` → intersection (merged fields)
 * - `oneOf` / `anyOf` → discriminated union when a discriminator is detectable,
 *   otherwise xor (`oneOf`) or union (`anyOf`)
 *
 * Per-branch `arg()` metadata is recovered from the original sub-schemas when
 * the vendor exposes them in order (Valibot `.options`); otherwise branch
 * fields fall back to JSON-Schema-only info.
 */
function extractFieldsFromStandardSchema(schema: ArgsSchema): ExtractedFields {
  const json = getJsonSchema(schema);
  const optionSchemas = getUnionOptionSchemas(schema);

  // Intersection: allOf of object branches, fields merged.
  if (Array.isArray(json.allOf) && json.allOf.length > 0) {
    const branchFields = json.allOf.map((branch, i) =>
      extractObjectBranchFields(branch, optionSchemas?.[i]),
    );
    return {
      fields: mergeBranchFields(branchFields),
      schema,
      schemaType: "intersection",
      unknownKeysMode: jsonUnknownKeysMode(json),
      ...(json.description ? { description: json.description } : {}),
    };
  }

  // Union-like: oneOf (exclusive) or anyOf.
  const branches = json.oneOf ?? json.anyOf;
  if (Array.isArray(branches) && branches.length > 0) {
    const branchFields = branches.map((branch, i) =>
      extractObjectBranchFields(branch, optionSchemas?.[i]),
    );
    const fields = mergeBranchFields(branchFields);
    const disc = detectJsonDiscriminator(branches);

    if (disc) {
      const variants = branches.map((branch, i) => ({
        discriminatorValue: disc.values[i]!,
        fields: branchFields[i]!,
        ...(branch.description ? { description: branch.description } : {}),
      }));
      return {
        fields,
        schema,
        schemaType: "discriminatedUnion",
        unknownKeysMode: jsonUnknownKeysMode(json),
        discriminator: disc.discriminator,
        variants,
        ...(json.description ? { description: json.description } : {}),
      };
    }

    const unionOptions: ExtractedFields[] = branches.map((branch, i) => ({
      fields: branchFields[i]!,
      schema,
      schemaType: "object",
      unknownKeysMode: jsonUnknownKeysMode(branch),
      ...(branch.description ? { description: branch.description } : {}),
    }));
    return {
      fields,
      schema,
      schemaType: json.oneOf ? "xor" : "union",
      unknownKeysMode: jsonUnknownKeysMode(json),
      unionOptions,
      ...(json.description ? { description: json.description } : {}),
    };
  }

  // Plain object.
  const properties = json.properties ?? {};
  const requiredSet = new Set(json.required ?? []);
  const fields = Object.entries(properties).map(([name, prop]) =>
    resolveFieldMetaFromJson(schema as object, name, prop, requiredSet.has(name)),
  );
  return {
    fields,
    schema,
    schemaType: "object",
    unknownKeysMode: jsonUnknownKeysMode(json),
    ...(json.description ? { description: json.description } : {}),
  };
}

// ---------------------------------------------------------------------------
// Internal schema extraction backend (politty's built-in commands)
// ---------------------------------------------------------------------------

/** Map an internal schema field kind to politty's CLI field type. */
function internalKindToFieldType(
  kind: string,
): "string" | "number" | "boolean" | "array" | "unknown" {
  switch (kind) {
    case "string":
    case "enum":
      return "string";
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      return "array";
    default:
      return "unknown";
  }
}

/**
 * Resolve field metadata from a single internal-schema child by reading its
 * state directly (no JSON Schema conversion, no Zod).
 */
function resolveInternalFieldMeta(name: string, child: InternalSchema): ResolvedFieldMeta {
  const argMeta = getArgMetaFromRegistry(child as object);
  return buildFieldMeta(name, argMeta, {
    description: child.state.description,
    type: internalKindToFieldType(child.state.kind),
    required: !child.state.optional,
    defaultValue: child.state.defaultValue,
    enumValues: child.state.enumValues,
    schema: child as unknown as z.ZodType,
  });
}

/**
 * Extract fields from politty's zero-dependency internal schema by reading its
 * state directly (no JSON Schema conversion, no Zod).
 */
function extractFieldsFromInternalSchema(schema: InternalSchema): ExtractedFields {
  const shape = schema.state.shape ?? {};
  const fields = Object.entries(shape).map(([name, child]) =>
    resolveInternalFieldMeta(name, child),
  );

  return {
    fields,
    schema: schema as unknown as ArgsSchema,
    schemaType: "object",
    unknownKeysMode: "strip",
  };
}

/**
 * Resolve field metadata for a single standalone non-Zod Standard Schema field
 * (e.g. a Valibot/ArkType arg schema used as a value in a docs `ArgsShape`).
 *
 * Standalone optionality is not reliably expressed in JSON Schema (it normally
 * lives in the parent object's `required` list), so `required` is best-effort:
 * a field is treated as optional only when it carries a default.
 */
function resolveStandaloneStandardFieldMeta(
  name: string,
  fieldSchema: ArgsSchema,
): ResolvedFieldMeta {
  const prop = getJsonSchema(fieldSchema);
  const argMeta =
    getArgMetaFromRegistry(fieldSchema as object) ??
    getArgMetaFromRegistry(unwrapStandardSchema(fieldSchema) as object);
  return buildFieldMeta(name, argMeta, {
    description: prop.description,
    type: jsonBaseType(prop),
    required: prop.default === undefined,
    defaultValue: prop.default,
    enumValues: jsonEnumValues(prop),
    schema: fieldSchema as unknown as z.ZodType,
  });
}

// ---------------------------------------------------------------------------
// Core-registered adapters
//
// The core registers the internal-schema adapter (vendor "politty", used by
// politty's built-in commands) and the generic Standard Schema adapter as the
// fallback for any other vendor (JSON Schema conversion; needs the optional
// "@standard-community/standard-json"). Native, dependency-free adapters for
// specific libraries are registered by importing their entrypoint:
// `politty/zod` (Zod `_def`), `politty/valibot` (Valibot internals).
// ---------------------------------------------------------------------------

const internalAdapter: SchemaAdapter = {
  vendors: ["politty"],
  extractFields: (schema) => extractFieldsFromInternalSchema(schema as unknown as InternalSchema),
  resolveField: (name, fieldSchema) =>
    resolveInternalFieldMeta(name, fieldSchema as InternalSchema),
  validate: (rawArgs, schema) => validateStandard(rawArgs, schema),
};

const standardAdapter: SchemaAdapter = {
  vendors: [],
  prepare: (schema) => prepareSchema(schema),
  extractFields: extractFieldsFromStandardSchema,
  resolveField: (name, fieldSchema) =>
    resolveStandaloneStandardFieldMeta(name, fieldSchema as ArgsSchema),
  validate: (rawArgs, schema) => validateStandard(rawArgs, schema),
};

registerSchemaAdapter(internalAdapter);
registerSchemaAdapter(standardAdapter, { fallback: true });

/**
 * Extract field metadata from a raw args *shape* — a `Record` of field name to
 * field schema — without wrapping it in any vendor's object schema. Each field
 * is resolved by the adapter for its own vendor, so shapes built from Zod,
 * politty's internal schema, or other Standard Schema libraries all work. Used
 * by the docs tooling (`renderArgsTable`, global-options handling).
 */
export function extractShapeFields(shape: Record<string, unknown>): ResolvedFieldMeta[] {
  return Object.entries(shape).map(([name, fieldSchema]) =>
    resolveSchemaAdapter(fieldSchema).resolveField(name, fieldSchema),
  );
}

/**
 * Cache for extractFields results to avoid redundant schema extraction
 */
const extractFieldsCache = new WeakMap<ArgsSchema, ExtractedFields>();

/**
 * Extract all fields from a schema, dispatching to the registered adapter for
 * the schema's Standard Schema vendor.
 *
 * @param schema - The args schema (ZodObject, ZodDiscriminatedUnion, Valibot/
 *   ArkType object, politty internal schema, ...)
 * @returns Extracted field information
 */
export function extractFields(schema: ArgsSchema): ExtractedFields {
  const cached = extractFieldsCache.get(schema);
  if (cached) return cached;

  const result = resolveSchemaAdapter(schema).extractFields(schema);
  extractFieldsCache.set(schema, result);
  return result;
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
