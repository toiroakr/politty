import type { z } from "zod";
import type { AnyCommand, ArgsSchema } from "../types.js";
import { validateStandard } from "../validator/standard-validator.js";
import { validateArgs } from "../validator/zod-validator.js";
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

/**
 * Get ArgMeta from both the custom registry and Zod's _def
 * Priority: custom registry > _def.argMeta
 */
function getArgMeta(schema: z.ZodType): ArgMeta | undefined {
  // First check custom registry
  const fromRegistry = getArgMetaFromRegistry(schema);
  if (fromRegistry) return fromRegistry;
  // Check Zod native meta
  // Some Zod versions or extensions use a global registry accessed via .meta()
  if (typeof (schema as any).meta === "function") {
    const meta = (schema as any).meta();
    if (meta && typeof meta === "object") {
      return meta as ArgMeta;
    }
  }

  // Then check _def.argMeta (for augmented Zod types)
  const def = (schema as any)._def;
  if (def?.argMeta) return def.argMeta;

  // Also check _def.meta just in case
  if (def?.meta) return def.meta as ArgMeta;

  return undefined;
}

// Internal type for accessing zod v4 internals
interface ZodV4Def {
  type?: string;
  innerType?: z.ZodType;
  schema?: z.ZodType;
  defaultValue?: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  shape?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  options?: any[];
  discriminator?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  left?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  right?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  catchall?: any;
  /** Pipe input schema (zod v4 transform/refine) */
  in?: z.ZodType;
  /** Pipe output schema (zod v4 transform/refine) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  out?: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodSchemaWithDef = z.ZodType & { def?: ZodV4Def; _def?: ZodV4Def; type?: string; shape?: any };

/**
 * Get the type name from a zod schema (v4 compatible)
 */
function getTypeName(schema: z.ZodType): string | undefined {
  const s = schema as ZodSchemaWithDef;
  return s.def?.type ?? s._def?.type ?? s.type;
}

/**
 * Detect unknown keys handling mode from a Zod object schema
 *
 * In Zod v4:
 * - Default (strip): _def.catchall is undefined
 * - strict: _def.catchall is ZodNever (type = "never")
 * - passthrough: _def.catchall is ZodUnknown (type = "unknown")
 */
export function getUnknownKeysMode(schema: z.ZodType): UnknownKeysMode {
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;
  const catchall = def?.catchall;

  if (!catchall) {
    // Default behavior: strip unknown keys (but we want to warn)
    return "strip";
  }

  const catchallType = getTypeName(catchall);

  if (catchallType === "never") {
    // z.strictObject() or z.object().strict() - reject unknown keys
    return "strict";
  }

  if (catchallType === "unknown" || catchallType === "any") {
    // z.looseObject() or z.object().passthrough() - allow unknown keys
    return "passthrough";
  }

  // Unknown catchall type, default to strip behavior
  return "strip";
}

/**
 * Get the inner schema, unwrapping optional, nullable, default, etc.
 */
function unwrapSchema(schema: z.ZodType): z.ZodType {
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  if (typeName === "optional" || typeName === "nullable" || typeName === "default") {
    const innerSchema = def?.innerType;
    if (innerSchema) {
      return unwrapSchema(innerSchema);
    }
  }

  // Handle effects (transform, refine, etc.)
  if (typeName === "pipe") {
    const innerSchema = def?.in ?? def?.schema;
    if (innerSchema) {
      return unwrapSchema(innerSchema);
    }
  }

  return schema;
}

/**
 * Detect the base type of a schema
 */
function detectType(schema: z.ZodType): "string" | "number" | "boolean" | "array" | "unknown" {
  const innerSchema = unwrapSchema(schema);
  const typeName = getTypeName(innerSchema);

  switch (typeName) {
    case "string":
    case "enum":
      return "string";
    case "number":
    case "int":
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
 * Extract enum values from a schema if it's an enum type
 *
 * @param schema - The Zod schema to extract enum values from
 * @returns Array of enum values if schema is an enum, undefined otherwise
 */
export function extractEnumValues(schema: z.ZodType): string[] | undefined {
  const innerSchema = unwrapSchema(schema);
  const typeName = getTypeName(innerSchema);
  const s = innerSchema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  if (typeName === "enum") {
    // Zod v4: enum values are in def.entries or def.values
    const entries = (def as { entries?: Record<string, string> })?.entries;
    if (entries && typeof entries === "object") {
      return Object.values(entries);
    }

    // Check for values array (some Zod versions)
    const values = (def as { values?: string[] })?.values;
    if (Array.isArray(values)) {
      return values;
    }

    // Fallback: check for options property on schema
    const options = (s as { options?: string[] }).options;
    if (Array.isArray(options)) {
      return options;
    }
  }

  // Handle array types: extract enum values from the element type
  if (typeName === "array") {
    const element = (def as { element?: z.ZodType })?.element;
    if (element) {
      return extractEnumValues(element);
    }
  }

  // Also handle literal union patterns (z.literal("a").or(z.literal("b")))
  if (typeName === "union") {
    const options = def?.options;
    if (Array.isArray(options)) {
      const literalValues: string[] = [];
      for (const option of options) {
        const optionTypeName = getTypeName(option);
        if (optionTypeName === "literal") {
          const optionDef = (option as ZodSchemaWithDef).def ?? (option as ZodSchemaWithDef)._def;
          const value = (optionDef as { value?: unknown; values?: unknown[] })?.value;
          const values = (optionDef as { value?: unknown; values?: unknown[] })?.values;
          const literalValue = value ?? values?.[0];
          if (typeof literalValue === "string") {
            literalValues.push(literalValue);
          }
        }
      }
      // Only return if all options are string literals
      if (literalValues.length === options.length && literalValues.length > 0) {
        return literalValues;
      }
    }
  }

  return undefined;
}

/**
 * Check if a schema is required (not optional or has default)
 *
 * Note: We only check isOptional(), not isNullable(), because CLI arguments
 * are either present (string value) or absent (undefined), never null.
 * Also, some coerce types incorrectly report isNullable()=true.
 */
function isRequired(schema: z.ZodType): boolean {
  return !schema.isOptional();
}

/**
 * Extract default value from schema if present
 */
function extractDefaultValue(schema: z.ZodType): unknown {
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  if (typeName === "default") {
    const defaultValue = def?.defaultValue;
    // In zod v4, defaultValue can be a direct value or a function
    if (typeof defaultValue === "function") {
      return defaultValue();
    }
    return defaultValue;
  }

  // Check for nested default in optional/nullable
  if (typeName === "optional" || typeName === "nullable") {
    const innerSchema = def?.innerType;
    if (innerSchema) {
      return extractDefaultValue(innerSchema);
    }
  }

  return undefined;
}

/**
 * Extract description from schema
 */
function extractDescription(schema: z.ZodType): string | undefined {
  // Check direct description
  if (schema.description) {
    return schema.description;
  }

  // Check inner schema for wrapped types
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  if (typeName === "optional" || typeName === "nullable" || typeName === "default") {
    const innerSchema = def?.innerType;
    if (innerSchema) {
      return extractDescription(innerSchema);
    }
  }

  return undefined;
}

/**
 * Resolve field metadata from a Zod sub-schema and the arg() registry.
 */
function resolveFieldMeta(name: string, schema: z.ZodType): ResolvedFieldMeta {
  // Get metadata from argRegistry (checking the wrapped inner schema too)
  const argMeta = getArgMeta(schema) ?? getArgMeta(unwrapSchema(schema));

  return buildFieldMeta(name, argMeta, {
    description: extractDescription(schema),
    type: detectType(schema),
    required: isRequired(schema),
    defaultValue: extractDefaultValue(schema),
    enumValues: extractEnumValues(schema),
    schema,
  });
}

/**
 * Get shape from a ZodObject
 */
function getObjectShape(schema: z.ZodType): Record<string, z.ZodType> {
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;
  return def?.shape ?? s.shape ?? {};
}

/**
 * Extract fields from a ZodObject
 */
function extractFromObject(schema: z.ZodType): ResolvedFieldMeta[] {
  const shape = getObjectShape(schema);
  return Object.entries(shape).map(([name, fieldSchema]) => resolveFieldMeta(name, fieldSchema));
}

/**
 * Extract fields from a discriminated union
 */
function extractFromDiscriminatedUnion(schema: z.ZodType): ExtractedFields {
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;
  const discriminator = def?.discriminator ?? "";
  const options = def?.options ?? [];

  // Collect all unique fields across all variants
  const allFieldsMap = new Map<string, ResolvedFieldMeta>();
  const variants: ExtractedFields["variants"] = [];

  for (const option of options) {
    const shape = getObjectShape(option as z.ZodObject<z.ZodRawShape>);
    const variantFields: ResolvedFieldMeta[] = [];

    // Get discriminator value from the variant's discriminator schema.
    // Supports z.literal() and single-value z.enum() discriminators.
    let discriminatorValue = "";
    const discriminatorSchema = shape[discriminator];
    if (discriminatorSchema) {
      const typeName = getTypeName(discriminatorSchema);
      if (typeName === "literal") {
        const litDef =
          (discriminatorSchema as ZodSchemaWithDef).def ??
          (discriminatorSchema as ZodSchemaWithDef)._def;
        // In Zod v4, literal values are in _def.values array
        const value = (litDef as { value?: unknown; values?: unknown[] })?.value;
        const values = (litDef as { value?: unknown; values?: unknown[] })?.values;
        discriminatorValue = String(value ?? values?.[0] ?? "");
      } else if (typeName === "enum") {
        // Only single-value enums map to one variant. Multi-value enums
        // (z.enum(['a','b'])) on a single variant are not standard for
        // discriminatedUnion and are not extracted here.
        const enumValues = extractEnumValues(discriminatorSchema);
        if (enumValues && enumValues.length === 1) {
          discriminatorValue = enumValues[0]!;
        }
      }
    }

    for (const [name, fieldSchema] of Object.entries(shape)) {
      const fieldMeta = resolveFieldMeta(name, fieldSchema);
      variantFields.push(fieldMeta);

      // Add to all fields map (first occurrence wins for metadata)
      if (!allFieldsMap.has(name)) {
        allFieldsMap.set(name, fieldMeta);
      }
    }

    // Extract description from the variant option
    const variantDescription = extractDescription(option as z.ZodType);

    variants.push({
      discriminatorValue,
      fields: variantFields,
      ...(variantDescription ? { description: variantDescription } : {}),
    });
  }

  const description = extractDescription(schema);
  return {
    fields: Array.from(allFieldsMap.values()),
    schema: schema as ArgsSchema,
    schemaType: "discriminatedUnion",
    unknownKeysMode: getUnknownKeysMode(schema),
    discriminator,
    variants,
    ...(description ? { description } : {}),
  };
}

/**
 * Extract fields from a union-like schema (union or xor)
 */
function extractFromUnionLike(schema: z.ZodType, schemaType: "union" | "xor"): ExtractedFields {
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;
  const options = def?.options ?? [];

  // Collect all unique fields across all options
  const allFieldsMap = new Map<string, ResolvedFieldMeta>();
  const unionOptions: ExtractedFields[] = [];

  for (const option of options) {
    // Extract fields for this option recursively
    // We cast to ArgsSchema because we expect options to be objects or other supported types
    const extracted = extractFields(option as ArgsSchema);
    unionOptions.push(extracted);

    // Add to combined fields map
    for (const field of extracted.fields) {
      if (!allFieldsMap.has(field.name)) {
        allFieldsMap.set(field.name, field);
      }
    }
  }

  const description = extractDescription(schema);
  return {
    fields: Array.from(allFieldsMap.values()),
    schema: schema as ArgsSchema,
    schemaType,
    unknownKeysMode: getUnknownKeysMode(schema),
    unionOptions,
    ...(description ? { description } : {}),
  };
}

/**
 * Extract fields from an intersection
 */
function extractFromIntersection(schema: z.ZodType): ExtractedFields {
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;
  const left = def?.left;
  const right = def?.right;

  const allFieldsMap = new Map<string, ResolvedFieldMeta>();

  // Helper to extract fields from a sub-schema
  const extractSubFields = (subSchema: z.ZodType | undefined) => {
    if (!subSchema) return;

    const extracted = extractFields(subSchema as ArgsSchema);
    for (const field of extracted.fields) {
      if (!allFieldsMap.has(field.name)) {
        allFieldsMap.set(field.name, field);
      }
    }
  };

  extractSubFields(left);
  extractSubFields(right);

  const description = extractDescription(schema);
  return {
    fields: Array.from(allFieldsMap.values()),
    schema: schema as ArgsSchema,
    schemaType: "intersection",
    unknownKeysMode: getUnknownKeysMode(schema),
    ...(description ? { description } : {}),
  };
}

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

/**
 * Resolve a single field's metadata, dispatching on the field schema's vendor
 * so any Standard Schema library (Zod, politty's internal schema, Valibot,
 * ArkType, ...) works without importing Zod at runtime.
 */
/**
 * Zod native introspection (`_def` walk) — the Zod adapter's extractor. Zod is
 * imported only as a type, so this never pulls Zod into the runtime bundle.
 */
function extractFieldsZod(schema: ArgsSchema): ExtractedFields {
  const zodSchema = schema as z.ZodType;
  const typeName = getTypeName(zodSchema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  switch (typeName) {
    case "object": {
      const description = extractDescription(zodSchema);
      return {
        fields: extractFromObject(zodSchema),
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(zodSchema),
        ...(description ? { description } : {}),
      };
    }

    case "union":
      // In Zod v4, discriminatedUnion has type "union" with a discriminator property
      return def?.discriminator
        ? extractFromDiscriminatedUnion(zodSchema)
        : extractFromUnionLike(zodSchema, "union");

    case "xor":
      return extractFromUnionLike(zodSchema, "xor");

    case "intersection":
      return extractFromIntersection(zodSchema);

    case "pipe": {
      // Handle transform/refine on top-level schema (e.g., z.object({...}).transform(...))
      const pipeInner = def?.in ?? def?.schema;
      const pipeDescription = extractDescription(zodSchema);
      if (pipeInner) {
        const innerResult = extractFields(pipeInner as ArgsSchema);
        return {
          ...innerResult,
          schema,
          ...(pipeDescription ? { description: pipeDescription } : {}),
        };
      }
      return {
        fields: [],
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(zodSchema),
        ...(pipeDescription ? { description: pipeDescription } : {}),
      };
    }

    default: {
      const description = extractDescription(zodSchema);
      // Fallback: try to treat as object
      return {
        fields: [],
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(zodSchema),
        ...(description ? { description } : {}),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Adapters
//
// Stage 1: all three adapters are defined and registered here in core so
// behavior is identical to the previous hard-coded vendor dispatch. A later
// stage moves the Zod adapter to the `politty/zod` entrypoint and the generic
// Standard Schema adapter to `politty/standard-schema`, leaving core to
// register only the internal adapter plus the generic fallback.
// ---------------------------------------------------------------------------

const zodAdapter: SchemaAdapter = {
  vendors: ["zod"],
  extractFields: extractFieldsZod,
  resolveField: (name, fieldSchema) => resolveFieldMeta(name, fieldSchema as z.ZodType),
  validate: (rawArgs, schema) => validateArgs(rawArgs, schema),
};

const internalAdapter: SchemaAdapter = {
  vendors: ["politty"],
  extractFields: (schema) => extractFieldsFromInternalSchema(schema as unknown as InternalSchema),
  resolveField: (name, fieldSchema) =>
    resolveInternalFieldMeta(name, fieldSchema as InternalSchema),
  validate: (rawArgs, schema) => validateStandard(rawArgs, schema),
};

const standardAdapter: SchemaAdapter = {
  vendors: [],
  extractFields: extractFieldsFromStandardSchema,
  resolveField: (name, fieldSchema) =>
    resolveStandaloneStandardFieldMeta(name, fieldSchema as ArgsSchema),
  validate: (rawArgs, schema) => validateStandard(rawArgs, schema),
};

registerSchemaAdapter(internalAdapter);
registerSchemaAdapter(zodAdapter);
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
