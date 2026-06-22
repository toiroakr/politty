import type { z } from "zod";
import type { AnyCommand, ArgsSchema } from "../types.js";
import {
  getArgMeta as getArgMetaFromRegistry,
  type ArgMeta,
  type CompletionMeta,
  type EffectContext,
  type PromptMeta,
} from "./arg-registry.js";
import type { InternalSchema } from "./internal-schema.js";
import {
  getChildSchema,
  getJsonSchema,
  getVendor,
  unwrapStandardSchema,
  type JsonSchema,
} from "./standard-schema.js";

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
 * Long flag names reserved for built-in handling (parseArgs / scanForSubcommand
 * intercept these before option parsing), so custom negation names must avoid them.
 */
const RESERVED_NEGATION_NAMES: ReadonlySet<string> = new Set(["help", "help-all", "version"]);

/**
 * Resolved metadata for an argument field
 */
export interface ResolvedFieldMeta {
  /** Field name (camelCase, as defined in schema) */
  name: string;
  /** CLI option name (kebab-case, for command line usage) */
  cliName: string;
  /**
   * Aliases for this option, normalized to an array.
   * 1-char entries are short aliases (`-v`); multi-char entries are long
   * aliases (`--to-be`).
   */
  alias?: string[] | undefined;
  /**
   * Aliases that are accepted at parse time but hidden from help,
   * generated docs, and shell completion.
   */
  hiddenAlias?: string[] | undefined;
  /** Argument description */
  description?: string | undefined;
  /** Whether this is a positional argument */
  positional: boolean;
  /** Placeholder for help display */
  placeholder?: string | undefined;
  /**
   * Environment variable name(s) to read value from.
   * If an array, earlier entries take priority.
   */
  env?: string | string[] | undefined;
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
  /** Enum values if detected from schema (z.enum) */
  enumValues?: string[] | undefined;
  /** Completion metadata from arg() */
  completion?: CompletionMeta | undefined;
  /** Prompt metadata from arg() for interactive input */
  prompt?: PromptMeta | undefined;
  /**
   * Negation configuration for this boolean field.
   *
   * - String (e.g. `"disable-cache"`): the default `--no-<cliName>` form is
   *   suppressed and only `--<negation>` (plus its camelCase variant) is
   *   accepted as the negation flag.
   * - `true`: the default `--no-<cliName>` form is accepted **and** shown in
   *   help, generated docs, and shell completions.
   * - `false`: neither the default `--no-<cliName>` nor any custom name is
   *   accepted; the field only responds to the positive flag.
   * - `undefined`: the default `--no-<cliName>` is accepted by the parser
   *   but hidden from help/docs/completions.
   *
   * Only applies to boolean fields; populated as `undefined` otherwise.
   */
  negation?: string | boolean | undefined;
  /**
   * Derived display name (no `--` prefix) for the negation flag in help,
   * generated docs, and shell completions. `undefined` means the negation
   * is hidden from those surfaces. Computed from `negation` + `cliName`.
   */
  negationDisplay?: string | undefined;
  /** Description shown for the negation option in help/docs. */
  negationDescription?: string | undefined;
  /** Side-effect callback from arg() metadata */
  effect?: ((value: unknown, context: EffectContext) => void | PromiseLike<void>) | undefined;
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
  /**
   * Unknown keys handling mode
   * - "strict": Unknown keys cause validation errors (z.strictObject or z.object().strict())
   * - "strip": Unknown keys trigger warnings (default, z.object())
   * - "passthrough": Unknown keys are silently ignored (z.looseObject or z.object().passthrough())
   */
  unknownKeysMode: UnknownKeysMode;
}

/**
 * Unknown keys handling mode for object schemas
 * - "strict": Unknown keys cause validation errors
 * - "strip": Unknown keys are silently ignored (default)
 * - "passthrough": Unknown keys are passed through
 */
export type UnknownKeysMode = "strict" | "strip" | "passthrough";

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
 * Convert camelCase to kebab-case
 * @example toKebabCase("dryRun") => "dry-run"
 * @example toKebabCase("outputDir") => "output-dir"
 * @example toKebabCase("XMLParser") => "xml-parser"
 */
export function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

/**
 * Convert hyphen-separated sequences to camelCase.
 *
 * Replaces `-x` (hyphen followed by a lowercase letter) with the uppercase
 * variant. Non-hyphenated input (e.g., already camelCase) is returned as-is.
 *
 * @param str - A string that may contain hyphens
 * @example toCamelCase("dry-run") => "dryRun"
 * @example toCamelCase("output-dir") => "outputDir"
 * @example toCamelCase("dryRun") => "dryRun"
 */
export function toCamelCase(str: string): string {
  return str.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
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
 * Schema-derived inputs for a field, computed by the introspection backend
 * (Zod native `_def` walk, or JSON Schema walk) and then normalized identically.
 */
export interface DerivedFieldInfo {
  /** Description sourced from the schema (arg() metadata still takes priority). */
  description?: string | undefined;
  /** Detected base type. */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** Whether the field is required. */
  required: boolean;
  /** Default value, if any. */
  defaultValue: unknown;
  /** Enum values, if the field is an enum/literal-union. */
  enumValues?: string[] | undefined;
  /** Original sub-schema reference (used by docs/golden tests). */
  schema: z.ZodType;
}

/**
 * Build a {@link ResolvedFieldMeta} from `arg()` metadata plus schema-derived
 * info. Holds all CLI-metadata normalization (alias / hiddenAlias / negation /
 * ...) and is shared by the Zod and JSON Schema extraction backends.
 */
function buildFieldMeta(
  name: string,
  argMeta: ArgMeta | undefined,
  derived: DerivedFieldInfo,
): ResolvedFieldMeta {
  // Priority: argRegistry > schema description
  const description = argMeta?.description ?? derived.description;

  // Convert camelCase field name to kebab-case for CLI usage
  const cliName = toKebabCase(name);

  const enumValues = derived.enumValues;
  const fieldType = derived.type;

  // Normalize alias-like inputs to a deduped, validated array (or undefined when empty).
  // Leading dashes are stripped for convenience; entries that still fail the pattern after
  // stripping cause a validation error so that invalid aliases are never silently ignored.
  const aliasPattern = /^[A-Za-z0-9][A-Za-z0-9-]*$/;
  const normalizeAliasList = (
    input: unknown,
    metaKey: "alias" | "hiddenAlias",
  ): string[] | undefined => {
    if (input == null) return undefined;
    const arr = Array.isArray(input) ? input : [input];
    const normalized = arr.map((a) => {
      if (typeof a !== "string") {
        throw new Error(
          `Invalid ${metaKey} for field "${name}": expected string or string[], received ${typeof a}.`,
        );
      }
      const candidate = a.trim().replace(/^-+/, "");
      if (candidate.length === 0 || !aliasPattern.test(candidate)) {
        throw new Error(
          `Invalid ${metaKey} "${a}" for field "${name}": aliases must match ${aliasPattern}.`,
        );
      }
      return candidate;
    });
    const result = Array.from(new Set(normalized));
    return result.length > 0 ? result : undefined;
  };

  const alias = normalizeAliasList(argMeta?.alias, "alias");
  // Filter hiddenAlias so it never overlaps with visible alias (visible wins)
  const visibleSet = new Set(alias ?? []);
  const hiddenAliasRaw = normalizeAliasList(
    (argMeta as { hiddenAlias?: string | string[] } | undefined)?.hiddenAlias,
    "hiddenAlias",
  );
  const hiddenAlias = hiddenAliasRaw?.filter((a) => !visibleSet.has(a));
  const hiddenAliasFinal = hiddenAlias && hiddenAlias.length > 0 ? hiddenAlias : undefined;

  // Validate and normalize `negation` (only meaningful for boolean fields).
  // Accepts:
  //   - string: custom negation CLI name (suppresses default `--no-*`)
  //   - true:   keep default `--no-*` and advertise it in help/docs/completion
  //   - false:  disable negation entirely (default `--no-*` also rejected)
  const rawNegation = (argMeta as { negation?: unknown } | undefined)?.negation;
  let negation: string | boolean | undefined;
  if (rawNegation !== undefined && rawNegation !== null) {
    if (typeof rawNegation === "boolean") {
      if (fieldType !== "boolean") {
        throw new Error(
          `Invalid negation for field "${name}": negation can only be used on boolean fields.`,
        );
      }
      negation = rawNegation;
    } else {
      if (typeof rawNegation !== "string") {
        throw new Error(
          `Invalid negation for field "${name}": expected string or boolean, received ${typeof rawNegation}.`,
        );
      }
      const candidate = rawNegation.trim().replace(/^-+/, "");
      if (candidate.length === 0 || !aliasPattern.test(candidate)) {
        throw new Error(
          `Invalid negation "${rawNegation}" for field "${name}": negation names must match ${aliasPattern}.`,
        );
      }
      if (RESERVED_NEGATION_NAMES.has(candidate)) {
        throw new Error(
          `Invalid negation "${rawNegation}" for field "${name}": negation cannot use reserved built-in flag names (${[
            ...RESERVED_NEGATION_NAMES,
          ]
            .map((n) => `--${n}`)
            .join(", ")}).`,
        );
      }
      if (fieldType !== "boolean") {
        throw new Error(
          `Invalid negation for field "${name}": negation can only be used on boolean fields.`,
        );
      }
      negation = candidate;
    }
  }

  const rawNegationDescription = (argMeta as { negationDescription?: unknown } | undefined)
    ?.negationDescription;
  let negationDescription: string | undefined;
  if (rawNegationDescription !== undefined && rawNegationDescription !== null) {
    if (typeof rawNegationDescription !== "string") {
      throw new Error(
        `Invalid negationDescription for field "${name}": expected string, received ${typeof rawNegationDescription}.`,
      );
    }
    if (negation === false) {
      throw new Error(
        `Invalid negationDescription for field "${name}": negationDescription cannot be used when negation is false.`,
      );
    }
    if (negation === undefined) {
      throw new Error(
        `Invalid negationDescription for field "${name}": negationDescription requires \`negation\` to be set (string or true).`,
      );
    }
    // Reject blank strings: downstream rendering treats falsy values as
    // "no description provided" and collapses to the inline `/` form, so
    // an empty/whitespace-only string would be silently ignored.
    const trimmed = rawNegationDescription.trim();
    if (trimmed.length === 0) {
      throw new Error(
        `Invalid negationDescription for field "${name}": negationDescription must be a non-empty string.`,
      );
    }
    negationDescription = trimmed;
  }

  // Compute the displayed negation name (without leading `--`) for help,
  // generated docs, and shell completions. `undefined` means hidden.
  const negationDisplay: string | undefined =
    typeof negation === "string" ? negation : negation === true ? `no-${cliName}` : undefined;

  const meta: ResolvedFieldMeta = {
    name,
    cliName,
    alias,
    hiddenAlias: hiddenAliasFinal,
    description,
    positional: argMeta?.positional ?? false,
    placeholder: argMeta?.placeholder,
    env: argMeta?.env,
    required: derived.required,
    defaultValue: derived.defaultValue,
    type: fieldType,
    schema: derived.schema,
    enumValues,
    completion: argMeta?.completion,
    prompt: argMeta?.prompt,
    negation,
    negationDisplay,
    negationDescription,
    effect: argMeta?.effect,
  };

  // Add overrideBuiltinAlias only if it's true
  if (argMeta && "overrideBuiltinAlias" in argMeta && argMeta.overrideBuiltinAlias === true) {
    meta.overrideBuiltinAlias = true;
  }

  return meta;
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
 * Get the combined list of visible + hidden aliases for a field.
 * Used by the parser and validators which treat both equally,
 * while help/docs/completion rely on `field.alias` only.
 */
export function getAllAliases(field: ResolvedFieldMeta): string[] {
  if (!field.alias && !field.hiddenAlias) return [];
  return [...(field.alias ?? []), ...(field.hiddenAlias ?? [])];
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
 * Extract fields from a non-Zod Standard Schema by converting it to JSON Schema.
 * Initial scope: object schemas. Unions/intersections degrade to no fields.
 */
function extractFieldsFromStandardSchema(schema: ArgsSchema): ExtractedFields {
  const json = getJsonSchema(schema);
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
function resolveAnyFieldMeta(name: string, fieldSchema: unknown): ResolvedFieldMeta {
  const vendor = getVendor(fieldSchema);
  if (vendor === "politty") {
    return resolveInternalFieldMeta(name, fieldSchema as InternalSchema);
  }
  if (vendor === "zod") {
    // Zod goes through `_def` reflection, which is type-only and never imports
    // Zod at runtime.
    return resolveFieldMeta(name, fieldSchema as z.ZodType);
  }
  if (vendor !== undefined) {
    return resolveStandaloneStandardFieldMeta(name, fieldSchema as ArgsSchema);
  }
  // No `~standard` marker: not a recognized schema. Every supported library
  // (Zod, politty's internal schema, Valibot, ArkType, ...) reports a vendor,
  // so this is an error rather than a value to guess at.
  throw new Error(
    `Cannot extract arg metadata for field "${name}": value is not a Standard Schema (missing "~standard" marker).`,
  );
}

/**
 * Extract field metadata from a raw args *shape* — a `Record` of field name to
 * field schema — without wrapping it in any vendor's object schema. Each field
 * is resolved by its own vendor, so shapes built from Zod, politty's internal
 * schema, or other Standard Schema libraries all work. Used by the docs tooling
 * (`renderArgsTable`, global-options handling) which receive shapes directly.
 */
export function extractShapeFields(shape: Record<string, unknown>): ResolvedFieldMeta[] {
  return Object.entries(shape).map(([name, fieldSchema]) => resolveAnyFieldMeta(name, fieldSchema));
}

/**
 * Cache for extractFields results to avoid redundant schema extraction
 */
const extractFieldsCache = new WeakMap<ArgsSchema, ExtractedFields>();

/**
 * Extract all fields from a schema
 *
 * @param schema - The args schema (ZodObject, ZodDiscriminatedUnion, etc.)
 * @returns Extracted field information
 */
export function extractFields(schema: ArgsSchema): ExtractedFields {
  const cached = extractFieldsCache.get(schema);
  if (cached) return cached;

  const vendor = getVendor(schema);
  // politty's built-in internal schema is introspected directly from its state.
  if (vendor === "politty") {
    const result = extractFieldsFromInternalSchema(schema as unknown as InternalSchema);
    extractFieldsCache.set(schema, result);
    return result;
  }
  // Other non-Zod Standard Schema vendors are introspected via JSON Schema
  // instead of Zod's native `_def`. This path never touches Zod at runtime.
  if (vendor !== undefined && vendor !== "zod") {
    const result = extractFieldsFromStandardSchema(schema);
    extractFieldsCache.set(schema, result);
    return result;
  }

  let result: ExtractedFields;
  // Zod native introspection path. Cast once to the Zod type the helpers below
  // expect; `schema` remains the broader ArgsSchema for the result payloads.
  const zodSchema = schema as z.ZodType;
  const typeName = getTypeName(zodSchema);
  const s = schema as ZodSchemaWithDef;
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

    case "pipe": {
      // Handle transform/refine on top-level schema (e.g., z.object({...}).transform(...))
      const pipeInner = def?.in ?? def?.schema;
      if (pipeInner) {
        const innerResult = extractFields(pipeInner as ArgsSchema);
        const pipeDescription = extractDescription(zodSchema);
        result = {
          ...innerResult,
          schema,
          ...(pipeDescription ? { description: pipeDescription } : {}),
        };
        break;
      }
      const pipeDescription = extractDescription(zodSchema);
      result = {
        fields: [],
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(zodSchema),
        ...(pipeDescription ? { description: pipeDescription } : {}),
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
