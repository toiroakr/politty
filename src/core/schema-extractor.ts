import { z } from "zod";
import type { ArgsSchema } from "../types.js";
import { getArgMeta as getArgMetaFromRegistry, type ArgMeta } from "./arg-registry.js";

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

/**
 * Resolved metadata for an argument field
 */
export interface ResolvedFieldMeta {
  /** Field name */
  name: string;
  /** Short alias (e.g., 'v' for --verbose) */
  alias?: string | undefined;
  /** Argument description */
  description?: string | undefined;
  /** Whether this is a positional argument */
  positional: boolean;
  /** Placeholder for help display */
  placeholder?: string | undefined;
  /** Whether this argument is required */
  required: boolean;
  /** Default value if any */
  defaultValue?: unknown;
  /** Detected type from schema */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** Original Zod schema */
  schema: z.ZodType;
  /** True if this overrides built-in aliases (-h, -H) */
  overrideBuiltinAlias?: true;
}

/**
 * Extracted fields from a schema
 */
export interface ExtractedFields {
  /** All field definitions */
  fields: ResolvedFieldMeta[];
  /** Original schema for validation */
  schema: ArgsSchema;
  /** Schema type */
  schemaType: "object" | "discriminatedUnion" | "union" | "xor" | "intersection";
  /** Discriminator key (for discriminatedUnion) */
  discriminator?: string;
  /** Variants (for discriminatedUnion) */
  variants?: Array<{
    discriminatorValue: string;
    fields: ResolvedFieldMeta[];
    description?: string;
  }>;
  /** Options (for union) */
  unionOptions?: ExtractedFields[];
  /** Schema description */
  description?: string;
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
    const innerSchema = def?.schema;
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
 * Resolve field metadata from schema and argRegistry
 */
function resolveFieldMeta(name: string, schema: z.ZodType): ResolvedFieldMeta {
  // Get metadata from argRegistry
  const argMeta = getArgMeta(schema) ?? getArgMeta(unwrapSchema(schema));

  // Priority: argRegistry > schema.describe()
  const description = argMeta?.description ?? extractDescription(schema);

  const meta: ResolvedFieldMeta = {
    name,
    alias: argMeta?.alias,
    description,
    positional: argMeta?.positional ?? false,
    placeholder: argMeta?.placeholder,
    required: isRequired(schema),
    defaultValue: extractDefaultValue(schema),
    type: detectType(schema),
    schema,
  };

  // Add overrideBuiltinAlias only if it's true
  if (argMeta && "overrideBuiltinAlias" in argMeta && argMeta.overrideBuiltinAlias === true) {
    meta.overrideBuiltinAlias = true;
  }

  return meta;
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

    // Get discriminator value
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
    discriminator,
    variants,
    ...(description ? { description } : {}),
  };
}

/**
 * Extract fields from a union
 */
function extractFromUnion(schema: z.ZodType): ExtractedFields {
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
    schemaType: "union",
    unionOptions,
    ...(description ? { description } : {}),
  };
}

/**
 * Extract fields from an xor (exclusive union)
 */
function extractFromXor(schema: z.ZodType): ExtractedFields {
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
    schemaType: "xor",
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
    ...(description ? { description } : {}),
  };
}

/**
 * Extract all fields from a schema
 *
 * @param schema - The args schema (ZodObject, ZodDiscriminatedUnion, etc.)
 * @returns Extracted field information
 */
export function extractFields(schema: ArgsSchema): ExtractedFields {
  const typeName = getTypeName(schema);
  const s = schema as ZodSchemaWithDef;
  const def = s.def ?? s._def;

  switch (typeName) {
    case "object": {
      const description = extractDescription(schema);
      return {
        fields: extractFromObject(schema),
        schema,
        schemaType: "object",
        ...(description ? { description } : {}),
      };
    }

    case "union":
      // In Zod v4, discriminatedUnion has type "union" with a discriminator property
      if (def?.discriminator) {
        return extractFromDiscriminatedUnion(schema);
      }
      return extractFromUnion(schema);

    case "xor":
      return extractFromXor(schema);

    case "intersection":
      return extractFromIntersection(schema);

    default: {
      const description = extractDescription(schema);
      // Fallback: try to treat as object
      return {
        fields: [],
        schema,
        schemaType: "object",
        ...(description ? { description } : {}),
      };
    }
  }
}

/**
 * Get all positional fields (sorted by order of definition)
 */
export function getPositionalFields(extracted: ExtractedFields): ResolvedFieldMeta[] {
  return extracted.fields.filter((f) => f.positional);
}

/**
 * Get all option fields (non-positional)
 */
export function getOptionFields(extracted: ExtractedFields): ResolvedFieldMeta[] {
  return extracted.fields.filter((f) => !f.positional);
}

/**
 * Build alias map from extracted fields
 */
export function buildAliasMap(extracted: ExtractedFields): Map<string, string> {
  const map = new Map<string, string>();
  for (const field of extracted.fields) {
    if (field.alias) {
      map.set(field.alias, field.name);
    }
  }
  return map;
}

/**
 * Error thrown when positional argument configuration is invalid
 */
export class PositionalConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PositionalConfigError";
  }
}

/**
 * Error thrown when a reserved alias is used
 */
export class ReservedAliasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReservedAliasError";
  }
}

/**
 * Validate positional argument configuration
 *
 * Rules:
 * - Array positional arguments must be the last positional
 * - No positional arguments can follow an array positional
 * - Required positional arguments cannot follow optional positional arguments
 * - Array positional and optional positional cannot be used together (ambiguous parsing)
 *
 * @param extracted - Extracted fields from schema
 * @throws {PositionalConfigError} If configuration is invalid
 */
export function validatePositionalConfig(extracted: ExtractedFields): void {
  const positionalFields = extracted.fields.filter((f) => f.positional);

  let foundArrayPositional: string | null = null;
  let foundOptionalPositional: string | null = null;

  for (const field of positionalFields) {
    // Check: no positional can follow array positional
    if (foundArrayPositional !== null) {
      throw new PositionalConfigError(
        `Positional argument "${field.name}" cannot follow array positional argument "${foundArrayPositional}". ` +
          `Array positional arguments must be the last positional.`,
      );
    }

    // Check: array positional cannot coexist with optional positional
    // (This check must come before "required after optional" because arrays are required)
    if (field.type === "array" && foundOptionalPositional !== null) {
      throw new PositionalConfigError(
        `Array positional argument "${field.name}" cannot be used with optional positional argument "${foundOptionalPositional}". ` +
          `This combination creates ambiguous parsing.`,
      );
    }

    // Check: required positional cannot follow optional positional
    if (foundOptionalPositional !== null && field.required) {
      throw new PositionalConfigError(
        `Required positional argument "${field.name}" cannot follow optional positional argument "${foundOptionalPositional}". ` +
          `Optional positional arguments must come after all required positionals.`,
      );
    }

    if (field.type === "array") {
      foundArrayPositional = field.name;
    }

    if (!field.required) {
      foundOptionalPositional = field.name;
    }
  }
}

/**
 * Validate that no reserved aliases are used without explicit override
 *
 * Reserved aliases:
 * - 'h' is reserved for --help
 * - 'H' is reserved for --help-all
 *
 * Users can override these by setting overrideBuiltinAlias: true
 *
 * @param extracted - Extracted fields from schema
 * @param hasSubCommands - Whether the command has subcommands
 * @throws {ReservedAliasError} If a reserved alias is used without override flag
 */
export function validateReservedAliases(
  extracted: ExtractedFields,
  _hasSubCommands: boolean,
): void {
  for (const field of extracted.fields) {
    // Check if field is trying to use reserved aliases without override flag
    if (field.alias === "h" || field.alias === "H") {
      if (field.overrideBuiltinAlias !== true) {
        throw new ReservedAliasError(
          `Alias "${field.alias}" is reserved for --${field.alias === "h" ? "help" : "help-all"}. ` +
            `To override this, set { alias: "${field.alias}", overrideBuiltinAlias: true } for "${field.name}".`,
        );
      }
    }
  }
}
