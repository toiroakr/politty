/**
 * zod/mini validator adapter: implements politty's neutral `ValidatorAdapter`
 * contract against zod v4's schema representation, exercised through the
 * `zod/mini` entry point.
 *
 * zod v4 unifies classic and mini schemas on the same `_zod`/`.def` core
 * representation, so almost all introspection here is the same structural
 * `.def` walk the classic `@politty/zod` adapter uses. The exceptions are
 * the handful of convenience methods `zod/mini` deliberately drops to stay
 * small (`.isOptional()`, the `.description` getter, the no-arg `.meta()`
 * getter) — each is replaced below with the same check those methods
 * perform internally in classic zod (verified against zod's own source):
 * `.isOptional()` is `this.safeParse(undefined).success`, and both
 * `.description` and `.meta()` just read `globalRegistry.get(this)`.
 *
 * Reading `globalRegistry` means this module — unlike the classic adapter —
 * does import `zod/mini` at runtime. That's fine here: a zod/mini-based CLI
 * always loads `zod/mini` anyway.
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
import { globalRegistry, type z } from "zod/mini";

/**
 * Get ArgMeta for a field schema, walking every wrapper layer (not just the
 * schema itself and its fully-unwrapped base).
 *
 * `arg()` keys its registry by exact schema identity. A field built as
 * `z.pipe(arg(z._default(...), {...}), z.transform(...))` registers the
 * metadata on the intermediate `default` node — checking only the outer
 * `pipe` and the fully-unwrapped inner schema (as a single non-recursive
 * `unwrapSchema` call would) skips that node entirely, silently dropping
 * aliases and other `arg()` options. Mirrors the valibot adapter's
 * `lookupRegistryMeta`, which walks the same kind of wrapper chain.
 *
 * Priority at each node: custom registry > `globalRegistry` (populated by
 * `.register()` or, on classic zod, by `.describe()`/`.meta()` — both write
 * to the same registry, so this reads correctly regardless of which flavor
 * produced it).
 */
function getArgMeta(schema: z.ZodMiniType, seen = new Set<z.ZodMiniType>()): ArgMeta | undefined {
  if (seen.has(schema)) return undefined;
  seen.add(schema);

  const fromRegistry = getArgMetaFromRegistry(schema);
  if (fromRegistry) return fromRegistry;

  const registryMeta = globalRegistry.get(schema);
  if (registryMeta && typeof registryMeta === "object") {
    return registryMeta as ArgMeta;
  }

  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def;

  if (typeName === "optional" || typeName === "nullable" || typeName === "default") {
    const innerSchema = def?.innerType;
    if (innerSchema) return getArgMeta(innerSchema, seen);
  }
  if (typeName === "pipe") {
    const innerSchema = def?.in;
    if (innerSchema) return getArgMeta(innerSchema, seen);
  }

  return undefined;
}

// Internal type for accessing zod v4 internals (shared shape between
// classic and mini — see module doc).
interface ZodV4Def {
  type?: string;
  innerType?: z.ZodMiniType;
  schema?: z.ZodMiniType;
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
  in?: z.ZodMiniType;
  /** Pipe output schema (zod v4 transform/refine) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  out?: any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ZodSchemaWithDef = z.ZodMiniType & { def?: ZodV4Def; type?: string; shape?: any };

/**
 * Get the type name from a zod schema. `zod/mini` always has `.def.type`
 * (and the shorthand `.type`), unlike classic's legacy `._def` alias, which
 * this package never needs to fall back to.
 */
function getTypeName(schema: z.ZodMiniType): string | undefined {
  const s = schema as ZodSchemaWithDef;
  return s.def?.type ?? s.type;
}

/**
 * Detect unknown keys handling mode from a Zod object schema
 *
 * In Zod v4:
 * - Default (strip): def.catchall is undefined
 * - strict: def.catchall is ZodNever (type = "never")
 * - passthrough: def.catchall is ZodUnknown (type = "unknown")
 */
export function getUnknownKeysMode(schema: z.ZodMiniType): UnknownKeysMode {
  // Unwrap so a wrapped object (e.g. z.optional(z.strictObject(...)) or a
  // top-level pipe) keeps the same unknown-keys handling the inner object
  // enforces at validation.
  const s = unwrapSchema(schema) as ZodSchemaWithDef;
  const def = s.def;
  const catchall = def?.catchall;

  if (!catchall) {
    // Default behavior: strip unknown keys (but we want to warn)
    return "strip";
  }

  const catchallType = getTypeName(catchall);

  if (catchallType === "never") {
    // z.strictObject() - reject unknown keys
    return "strict";
  }

  if (catchallType === "unknown" || catchallType === "any") {
    // z.looseObject() - allow unknown keys
    return "passthrough";
  }

  // Unknown catchall type, default to strip behavior
  return "strip";
}

/**
 * Get the inner schema, unwrapping optional, nullable, default, etc.
 */
function unwrapSchema(schema: z.ZodMiniType): z.ZodMiniType {
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def;

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
function detectType(schema: z.ZodMiniType): ResolvedFieldMeta["type"] {
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
export function extractEnumValues(schema: z.ZodMiniType): string[] | undefined {
  const innerSchema = unwrapSchema(schema);
  const typeName = getTypeName(innerSchema);
  const s = innerSchema as ZodSchemaWithDef;
  const def = s.def;

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
    const element = (def as { element?: z.ZodMiniType })?.element;
    if (element) {
      return extractEnumValues(element);
    }
  }

  // Also handle literal union patterns (z.union([z.literal("a"), z.literal("b")]))
  if (typeName === "union") {
    const options = def?.options;
    if (Array.isArray(options)) {
      const literalValues: string[] = [];
      for (const option of options) {
        const optionTypeName = getTypeName(option);
        if (optionTypeName === "literal") {
          const optionDef = (option as ZodSchemaWithDef).def;
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
 * `zod/mini` has no `.isOptional()` method — classic's own implementation of
 * it is exactly this behavioral check (verified against zod's classic
 * source), and `.safeParse` exists on both flavors.
 *
 * Note: We only check this, not nullability, because CLI arguments are
 * either present (string value) or absent (undefined), never null. Also,
 * some coerce types incorrectly report as nullable.
 */
function isRequired(schema: z.ZodMiniType): boolean {
  return !schema.safeParse(undefined).success;
}

/**
 * Extract default value from schema if present
 *
 * Recurses through `pipe`'s `def.in` (not just `optional`/`nullable`) so a
 * default declared before a `.transform()`/`.refine()` pipe — e.g.
 * `z.pipe(z._default(z.string(), "x"), z.transform(...))` — is still found.
 * Without this, such a field reported `required: false` (from `isRequired`'s
 * `safeParse(undefined)` check, which does apply the default) alongside a
 * silently missing `defaultValue`, an inconsistency that broke help text and
 * completion for defaulted+piped fields.
 */
function extractDefaultValue(schema: z.ZodMiniType): unknown {
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def;

  if (typeName === "default") {
    const defaultValue = def?.defaultValue;
    // In zod v4, defaultValue can be a direct value or a function
    if (typeof defaultValue === "function") {
      return defaultValue();
    }
    return defaultValue;
  }

  // Check for nested default in optional/nullable/pipe
  if (typeName === "optional" || typeName === "nullable") {
    const innerSchema = def?.innerType;
    if (innerSchema) {
      return extractDefaultValue(innerSchema);
    }
  }
  if (typeName === "pipe") {
    const innerSchema = def?.in;
    if (innerSchema) {
      return extractDefaultValue(innerSchema);
    }
  }

  return undefined;
}

/**
 * Extract description from schema, recursing into wrappers.
 *
 * `zod/mini` has no `.description` getter — classic's own implementation of
 * it just reads `globalRegistry.get(this)?.description` (verified against
 * zod's classic source), so read the registry directly instead.
 *
 * Also recurses through `pipe`'s `def.in`, matching `extractDefaultValue`:
 * a description registered on the input schema of a `.transform()`/
 * `.refine()` pipe — e.g.
 * `z.pipe(schema.register(z.globalRegistry, {...}), z.transform(...))` —
 * would otherwise be silently dropped.
 */
function extractDescription(schema: z.ZodMiniType): string | undefined {
  const direct = globalRegistry.get(schema)?.description;
  if (direct) {
    return direct;
  }

  // Check inner schema for wrapped types
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def;

  if (typeName === "optional" || typeName === "nullable" || typeName === "default") {
    const innerSchema = def?.innerType;
    if (innerSchema) {
      return extractDescription(innerSchema);
    }
  }
  if (typeName === "pipe") {
    const innerSchema = def?.in;
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
export function resolveZodMiniFieldMeta(name: string, schema: z.ZodMiniType): ResolvedFieldMeta {
  const argMeta = getArgMeta(schema);
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
 * Get shape from a ZodMiniObject
 */
function getObjectShape(schema: z.ZodMiniType): Record<string, z.ZodMiniType> {
  const s = schema as ZodSchemaWithDef;
  const def = s.def;
  return def?.shape ?? s.shape ?? {};
}

/**
 * Extract fields from a ZodMiniObject
 */
function extractFromObject(schema: z.ZodMiniType): ResolvedFieldMeta[] {
  const shape = getObjectShape(schema);
  return Object.entries(shape).map(([name, fieldSchema]) =>
    resolveZodMiniFieldMeta(name, fieldSchema),
  );
}

/**
 * Extract fields from a discriminated union
 */
function extractFromDiscriminatedUnion(schema: z.ZodMiniType): ExtractedFields {
  const s = schema as ZodSchemaWithDef;
  const def = s.def;
  const discriminator = def?.discriminator ?? "";
  const options = def?.options ?? [];

  // Collect all unique fields across all variants
  const allFieldsMap = new Map<string, ResolvedFieldMeta>();
  const variants: ExtractedFields["variants"] = [];

  for (const option of options) {
    const shape = getObjectShape(option as z.ZodMiniType);
    const variantFields: ResolvedFieldMeta[] = [];

    // Get discriminator value from the variant's discriminator schema.
    // Supports z.literal() and single-value z.enum() discriminators.
    let discriminatorValue = "";
    const discriminatorSchema = shape[discriminator];
    if (discriminatorSchema) {
      const typeName = getTypeName(discriminatorSchema);
      if (typeName === "literal") {
        const litDef = (discriminatorSchema as ZodSchemaWithDef).def;
        // In Zod v4, literal values are in def.values array
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
      const fieldMeta = resolveZodMiniFieldMeta(name, fieldSchema);
      variantFields.push(fieldMeta);

      // Add to all fields map (first occurrence wins for metadata)
      if (!allFieldsMap.has(name)) {
        allFieldsMap.set(name, fieldMeta);
      }
    }

    // Extract description from the variant option
    const variantDescription = extractDescription(option as z.ZodMiniType);

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
function extractFromUnionLike(schema: z.ZodMiniType, schemaType: "union" | "xor"): ExtractedFields {
  const s = schema as ZodSchemaWithDef;
  const def = s.def;
  const options = def?.options ?? [];

  // Collect all unique fields across all options
  const allFieldsMap = new Map<string, ResolvedFieldMeta>();
  const unionOptions: ExtractedFields[] = [];

  for (const option of options) {
    // Extract fields for this option recursively
    // We cast to ArgsSchema because we expect options to be objects or other supported types
    const extracted = extractZodMiniFields(option as ArgsSchema);
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
function extractFromIntersection(schema: z.ZodMiniType): ExtractedFields {
  const s = schema as ZodSchemaWithDef;
  const def = s.def;
  const left = def?.left;
  const right = def?.right;

  const allFieldsMap = new Map<string, ResolvedFieldMeta>();

  // Helper to extract fields from a sub-schema
  const extractSubFields = (subSchema: z.ZodMiniType | undefined) => {
    if (!subSchema) return;

    const extracted = extractZodMiniFields(subSchema as ArgsSchema);
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
 * Cache for extractZodMiniFields results to avoid redundant schema extraction
 */
const extractFieldsCache = new WeakMap<ArgsSchema, ExtractedFields>();

/**
 * Extract all fields from a zod/mini args schema
 * (ZodMiniObject, ZodMiniDiscriminatedUnion, etc.)
 */
export function extractZodMiniFields(schema: ArgsSchema): ExtractedFields {
  const cached = extractFieldsCache.get(schema);
  if (cached) return cached;

  // Core's ArgsSchema is the neutral Standard Schema shape; everything in
  // this module introspects the concrete zod/mini representation behind it.
  const zodSchema = schema as unknown as z.ZodMiniType;

  let result: ExtractedFields;
  const typeName = getTypeName(zodSchema);
  const s = zodSchema as ZodSchemaWithDef;
  const def = s.def;

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
      // top-level schema (`z.pipe(z.object({...}), ...)`), this covers
      // wrappers that keep an object output type — `z._default(z.object({...}), {})`
      // type-checks as an args schema, and without unwrapping it fell through
      // to the fallback below and extracted zero fields, silently breaking
      // parsing, help, docs, and completion for the command.
      const inner = def?.innerType ?? def?.in ?? def?.schema;
      if (inner) {
        const innerResult = extractZodMiniFields(inner as ArgsSchema);
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
 * Structural view of a zod/mini issue (`$ZodIssue`). `received`/`expected`
 * only exist on some issue subtypes, hence the `in` checks below.
 */
interface ZodMiniIssue {
  path: PropertyKey[];
  message: string;
  code: string;
  received?: unknown;
  expected?: unknown;
}

/**
 * Convert a zod/mini `$ZodError` to a ValidationError array
 */
function formatZodErrors(error: { issues: readonly ZodMiniIssue[] }): ValidationError[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String),
    message: issue.message,
    code: issue.code,
    received: "received" in issue ? issue.received : undefined,
    expected: "expected" in issue ? String(issue.expected) : undefined,
  }));
}

/**
 * Validate raw arguments against a zod/mini schema
 */
export function validateZodMiniArgs(
  rawArgs: Record<string, unknown>,
  schema: ArgsSchema,
): ValidationResult<unknown> {
  const result = (schema as z.ZodMiniType).safeParse(rawArgs);

  if (result.success) {
    return { success: true, data: result.data };
  }

  return {
    success: false,
    errors: formatZodErrors(result.error),
  };
}

/**
 * The zod/mini validator adapter.
 */
export const zodMiniAdapter: ValidatorAdapter = {
  vendor: "zod-mini",
  extractFields: extractZodMiniFields,
  resolveFieldMeta: (name, fieldSchema) =>
    resolveZodMiniFieldMeta(name, fieldSchema as z.ZodMiniType),
  getUnknownKeysMode: (schema) => getUnknownKeysMode(schema as unknown as z.ZodMiniType),
  validate: validateZodMiniArgs,
};
