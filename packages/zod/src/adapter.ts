/**
 * Zod validator adapter: implements politty's neutral `ValidatorAdapter`
 * contract against zod v4's schema representation.
 *
 * All introspection here is structural (`_def` / `.def` access, method
 * calls on the schema object) — this module never imports zod at runtime,
 * so it stays out of the user's startup path until a zod schema actually
 * flows through it.
 */

import {
  resolveFieldMeta as assembleFieldMeta,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "@politty/core/adapter/field-meta";
import type {
  ValidationError,
  ValidationResult,
  ValidatorAdapter,
} from "@politty/core/adapter/types";
import {
  getArgMeta as getArgMetaFromRegistry,
  type ArgMeta,
} from "@politty/core/core/arg-registry";
import type { ArgsSchema } from "@politty/core/types";
import type { z } from "zod";

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
  // Unwrap so a wrapped object (e.g. z.strictObject(...).optional() or a
  // top-level .transform() pipe) keeps the same unknown-keys handling the
  // inner object enforces at validation.
  const s = unwrapSchema(schema) as ZodSchemaWithDef;
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
function detectType(schema: z.ZodType): ResolvedFieldMeta["type"] {
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
 * Resolve field metadata from a zod field schema. The zod-specific
 * introspection happens here; the shared alias/negation policy lives in
 * `resolveFieldMeta` (adapter/field-meta.ts).
 */
export function resolveZodFieldMeta(name: string, schema: z.ZodType): ResolvedFieldMeta {
  const argMeta = getArgMeta(schema) ?? getArgMeta(unwrapSchema(schema));
  return assembleFieldMeta(name, {
    argMeta,
    description: extractDescription(schema),
    required: isRequired(schema),
    defaultValue: extractDefaultValue(schema),
    type: detectType(schema),
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
  return Object.entries(shape).map(([name, fieldSchema]) => resolveZodFieldMeta(name, fieldSchema));
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
      const fieldMeta = resolveZodFieldMeta(name, fieldSchema);
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
    const extracted = extractZodFields(option as ArgsSchema);
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

    const extracted = extractZodFields(subSchema as ArgsSchema);
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

/**
 * Cache for extractZodFields results to avoid redundant schema extraction
 */
const extractFieldsCache = new WeakMap<ArgsSchema, ExtractedFields>();

/**
 * Extract all fields from a zod args schema
 * (ZodObject, ZodDiscriminatedUnion, etc.)
 */
export function extractZodFields(schema: ArgsSchema): ExtractedFields {
  const cached = extractFieldsCache.get(schema);
  if (cached) return cached;

  // Core's ArgsSchema is the neutral Standard Schema shape; everything in
  // this module introspects the concrete zod representation behind it.
  const zodSchema = schema as unknown as z.ZodType;

  let result: ExtractedFields;
  const typeName = getTypeName(zodSchema);
  const s = zodSchema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  switch (typeName) {
    case "object": {
      const description = extractDescription(zodSchema);
      result = {
        fields: extractFromObject(zodSchema),
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(zodSchema),
        ...(description ? { description } : {}),
      };
      break;
    }

    case "union":
      // In Zod v4, discriminatedUnion has type "union" with a discriminator property
      if (def?.discriminator) {
        result = extractFromDiscriminatedUnion(zodSchema);
      } else {
        result = extractFromUnionLike(zodSchema, "union");
      }
      break;

    case "xor":
      result = extractFromUnionLike(zodSchema, "xor");
      break;

    case "intersection":
      result = extractFromIntersection(zodSchema);
      break;

    case "optional":
    case "nullable":
    case "default":
    case "pipe": {
      // Unwrap and reuse the inner result. Besides transform/refine on a
      // top-level schema (`z.object({...}).transform(...)`), this covers
      // wrappers that keep an object output type — `z.object({...}).default({})`
      // type-checks as an args schema, and without unwrapping it fell through
      // to the fallback below and extracted zero fields, silently breaking
      // parsing, help, docs, and completion for the command.
      const inner = def?.innerType ?? def?.in ?? def?.schema;
      if (inner) {
        const innerResult = extractZodFields(inner as ArgsSchema);
        const wrapperDescription = extractDescription(zodSchema);
        result = {
          // `schema` stays the wrapper so validation still applies it.
          ...innerResult,
          schema,
          ...(wrapperDescription ? { description: wrapperDescription } : {}),
        };
        break;
      }
      const wrapperDescription = extractDescription(zodSchema);
      result = {
        fields: [],
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(zodSchema),
        ...(wrapperDescription ? { description: wrapperDescription } : {}),
      };
      break;
    }

    default: {
      const description = extractDescription(zodSchema);
      // Fallback: try to treat as object
      result = {
        fields: [],
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(zodSchema),
        ...(description ? { description } : {}),
      };
      break;
    }
  }

  extractFieldsCache.set(schema, result);
  return result;
}

/**
 * Convert ZodError to ValidationError array (zod v4 compatible)
 */
function formatZodErrors(error: z.ZodError): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
    received: "received" in issue ? issue.received : undefined,
    expected: "expected" in issue ? String(issue.expected) : undefined,
  }));
}

/**
 * Validate raw arguments against a zod schema
 */
export function validateZodArgs(
  rawArgs: Record<string, unknown>,
  schema: ArgsSchema,
): ValidationResult<unknown> {
  const result = (schema as z.ZodType).safeParse(rawArgs);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
  };
}

/**
 * The zod validator adapter.
 */
export const zodAdapter: ValidatorAdapter = {
  vendor: "zod",
  extractFields: extractZodFields,
  resolveFieldMeta: (name, fieldSchema) => resolveZodFieldMeta(name, fieldSchema as z.ZodType),
  getUnknownKeysMode: (schema) => getUnknownKeysMode(schema as unknown as z.ZodType),
  validate: validateZodArgs,
};
