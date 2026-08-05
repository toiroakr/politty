/**
 * Valibot validator adapter: implements politty's neutral `ValidatorAdapter`
 * contract against valibot v1's schema representation.
 *
 * Valibot schemas are plain objects (`kind` / `type` / `entries` / `pipe`
 * properties are public API), so all introspection here is structural.
 * Validation goes through `safeParse` so error output keeps valibot's
 * issue detail (`type` / `expected` / `received`).
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
import { safeParse, type GenericSchema } from "valibot";

/**
 * Structural view of a valibot schema / pipe item. `v.pipe(...)` spreads its
 * first schema and adds a `pipe` array, so a piped schema exposes the base
 * schema's `type` directly plus every pipe item (schemas, validation actions,
 * metadata actions, transformations).
 */
interface ValibotNode {
  kind?: "schema" | "validation" | "transformation" | "metadata";
  type?: string;
  /** Wrapper schemas (optional, nullable, nullish, exact_optional, undefinedable) */
  wrapped?: ValibotNode;
  /** Default value or factory on wrapper schemas */
  default?: unknown;
  /** Object entries (object, strict_object, loose_object, object_with_rest) */
  entries?: Record<string, ValibotNode>;
  /** Union / variant / intersect members */
  options?: unknown[];
  /** Variant discriminator key */
  key?: string;
  /** Array element schema */
  item?: ValibotNode;
  /** Literal value (literal schema) */
  literal?: unknown;
  /** Enum values (enum schema) */
  enum?: Record<string, unknown>;
  /** Pipe items (first item is the spread base schema) */
  pipe?: ValibotNode[];
  /** Metadata action payloads */
  description?: string;
  metadata?: Record<string, unknown>;
}

function asNode(schema: unknown): ValibotNode {
  return schema as ValibotNode;
}

/** Wrapper types that make a field accept a missing / undefined value. */
const OPTIONAL_WRAPPERS: ReadonlySet<string> = new Set([
  "optional",
  "exact_optional",
  "nullish",
  "undefinedable",
]);

/** Wrapper types that carry a `wrapped` inner schema. */
const UNWRAPPABLE: ReadonlySet<string> = new Set([
  "optional",
  "exact_optional",
  "nullish",
  "undefinedable",
  "nullable",
  "non_optional",
  "non_nullable",
  "non_nullish",
]);

/**
 * Get the inner schema, unwrapping optional/nullable/etc. wrappers. Piped
 * schemas need no explicit handling: `v.pipe` spreads its base schema, so
 * the wrapper's own properties are already visible on the pipe result.
 */
function unwrapSchema(schema: ValibotNode): ValibotNode {
  let current = schema;
  while (current.type && UNWRAPPABLE.has(current.type) && current.wrapped) {
    current = current.wrapped;
  }
  return current;
}

/**
 * Detect the base type of a schema.
 *
 * Input-side detection (matching the zod adapter, which unwraps pipes to
 * their input schema): the CLI parser cares about what the user types, not
 * what a transform produces. The one refinement is `unknown`/`any` inputs —
 * the idiomatic valibot coercion pattern is
 * `v.pipe(v.unknown(), v.transform(Number), v.number())`, where the input
 * schema says nothing; in that case the later pipe schemas are scanned so
 * the field still presents as a number in help / prompts / completion.
 */
function detectType(schema: ValibotNode): ResolvedFieldMeta["type"] {
  const inner = unwrapSchema(schema);
  const detected = bucketOf(inner.type);
  if (detected !== "unknown") return detected;

  if ((inner.type === "unknown" || inner.type === "any") && Array.isArray(inner.pipe)) {
    for (const item of inner.pipe) {
      if (item.kind === "schema") {
        const bucket = bucketOf(item.type);
        if (bucket !== "unknown") return bucket;
      }
    }
  }
  return "unknown";
}

function bucketOf(type: string | undefined): ResolvedFieldMeta["type"] {
  switch (type) {
    case "string":
    case "picklist":
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
 * Extract enum values from a schema if it's enum-like
 * (picklist, enum, array of enums, or a union of string literals).
 */
export function extractEnumValues(schema: unknown): string[] | undefined {
  const inner = unwrapSchema(asNode(schema));

  if (inner.type === "picklist" && Array.isArray(inner.options)) {
    const values = inner.options.filter((o): o is string => typeof o === "string");
    return values.length > 0 ? values : undefined;
  }

  if (inner.type === "enum" && inner.enum && typeof inner.enum === "object") {
    const values = Object.values(inner.enum).filter((v): v is string => typeof v === "string");
    return values.length > 0 ? values : undefined;
  }

  // Array types: extract enum values from the element type
  if (inner.type === "array" && inner.item) {
    return extractEnumValues(inner.item);
  }

  // Union of string literals (v.union([v.literal("a"), v.literal("b")]))
  if (inner.type === "union" && Array.isArray(inner.options)) {
    const literalValues: string[] = [];
    for (const option of inner.options) {
      const node = asNode(option);
      if (node.type === "literal" && typeof node.literal === "string") {
        literalValues.push(node.literal);
      }
    }
    if (literalValues.length === inner.options.length && literalValues.length > 0) {
      return literalValues;
    }
  }

  return undefined;
}

/**
 * Check if a schema is required: no optional-ish wrapper anywhere in the
 * wrapper chain. Mirrors the zod adapter's `isOptional()` semantics —
 * `nullable` alone does NOT make a CLI arg optional (CLI values are present
 * or absent, never null).
 */
function isRequired(schema: ValibotNode): boolean {
  let current = schema;
  while (current.type && UNWRAPPABLE.has(current.type)) {
    if (OPTIONAL_WRAPPERS.has(current.type)) return false;
    if (!current.wrapped) break;
    current = current.wrapped;
  }
  return true;
}

/**
 * Extract the declared default value, walking the wrapper chain.
 * Factory defaults (`v.optional(schema, () => value)`) are invoked, matching
 * `v.getDefault` and the zod adapter's behavior for `.default(() => ...)`.
 */
function extractDefaultValue(schema: ValibotNode): unknown {
  let current: ValibotNode | undefined = schema;
  while (current?.type && UNWRAPPABLE.has(current.type)) {
    if (current.default !== undefined) {
      return typeof current.default === "function"
        ? (current.default as () => unknown)()
        : current.default;
    }
    current = current.wrapped;
  }
  return undefined;
}

/**
 * Extract a description from `v.description(...)` metadata actions in the
 * schema's pipe, recursing into wrappers. The last action wins, matching
 * valibot's `v.getDescription` behavior for a single pipe.
 *
 * Hand-rolled rather than `v.getDescription` / `v.getDefault` because the
 * official utilities do not look through wrapper schemas — e.g.
 * `v.getDescription(v.optional(v.pipe(v.string(), v.description("x"))))`
 * returns `undefined` — while zod-adapter parity requires descriptions and
 * defaults declared on the wrapped inner schema to be found.
 */
function extractDescription(schema: ValibotNode): string | undefined {
  if (Array.isArray(schema.pipe)) {
    let description: string | undefined;
    for (const item of schema.pipe) {
      if (item.kind === "metadata" && item.type === "description") {
        if (typeof item.description === "string") description = item.description;
      }
    }
    if (description !== undefined) return description;
  }

  if (schema.type && UNWRAPPABLE.has(schema.type) && schema.wrapped) {
    return extractDescription(schema.wrapped);
  }

  return undefined;
}

/**
 * Extract `v.metadata({...})` action content from the schema's pipe,
 * recursing into wrappers. Later actions win key-by-key.
 */
function extractMetadataAction(schema: ValibotNode): Record<string, unknown> | undefined {
  let merged: Record<string, unknown> | undefined;

  if (schema.type && UNWRAPPABLE.has(schema.type) && schema.wrapped) {
    merged = extractMetadataAction(schema.wrapped);
  }

  if (Array.isArray(schema.pipe)) {
    for (const item of schema.pipe) {
      if (item.kind === "metadata" && item.type === "metadata" && item.metadata) {
        merged = { ...merged, ...item.metadata };
      }
    }
  }

  return merged;
}

/**
 * Get ArgMeta for a field schema.
 * Priority: politty's arg() registry > `v.metadata({...})` pipe actions.
 */
function getArgMeta(schema: ValibotNode): ArgMeta | undefined {
  const fromRegistry =
    getArgMetaFromRegistry(schema) ?? getArgMetaFromRegistry(unwrapSchema(schema));
  if (fromRegistry) return fromRegistry;

  const fromMetadataAction = extractMetadataAction(schema);
  if (fromMetadataAction) return fromMetadataAction as ArgMeta;

  return undefined;
}

/**
 * Resolve field metadata from a valibot field schema. The valibot-specific
 * introspection happens here; the shared alias/negation policy lives in
 * `resolveFieldMeta` (adapter/field-meta.ts).
 */
export function resolveValibotFieldMeta(name: string, schema: unknown): ResolvedFieldMeta {
  const node = asNode(schema);
  return assembleFieldMeta(name, {
    argMeta: getArgMeta(node),
    description: extractDescription(node),
    required: isRequired(node),
    defaultValue: extractDefaultValue(node),
    type: detectType(node),
    enumValues: extractEnumValues(node),
    schema,
  });
}

/**
 * Detect unknown keys handling mode from a valibot object schema.
 *
 * - `v.object()`: strips unknown keys (politty warns) → "strip"
 * - `v.strictObject()`: rejects unknown keys → "strict"
 * - `v.looseObject()` / `v.objectWithRest()`: keeps unknown keys → "passthrough"
 */
export function getUnknownKeysMode(schema: unknown): UnknownKeysMode {
  switch (asNode(schema).type) {
    case "strict_object":
      return "strict";
    case "loose_object":
    case "object_with_rest":
      return "passthrough";
    default:
      return "strip";
  }
}

/**
 * Extract fields from an object-like schema's entries
 */
function extractFromObject(schema: ValibotNode): ResolvedFieldMeta[] {
  const entries = schema.entries ?? {};
  return Object.entries(entries).map(([name, fieldSchema]) =>
    resolveValibotFieldMeta(name, fieldSchema),
  );
}

/**
 * Get the discriminator value of one variant option for `v.variant(key, ...)`.
 * Supports `v.literal()` and single-value `v.picklist()` / `v.enum()`.
 */
function getDiscriminatorValue(option: ValibotNode, key: string): string {
  const discriminatorSchema = option.entries?.[key];
  if (!discriminatorSchema) return "";

  const inner = unwrapSchema(discriminatorSchema);
  if (inner.type === "literal" && inner.literal !== undefined) {
    return String(inner.literal);
  }
  const enumValues = extractEnumValues(inner);
  if (enumValues && enumValues.length === 1) {
    return enumValues[0]!;
  }
  return "";
}

/**
 * Extract fields from `v.variant(key, [...])` (valibot's discriminated union)
 */
function extractFromVariant(schema: ValibotNode): ExtractedFields {
  const discriminator = schema.key ?? "";
  const options = schema.options ?? [];

  // Collect all unique fields across all variants
  const allFieldsMap = new Map<string, ResolvedFieldMeta>();
  const variants: ExtractedFields["variants"] = [];

  for (const option of options) {
    const optionNode = asNode(option);
    const variantFields: ResolvedFieldMeta[] = [];

    for (const [name, fieldSchema] of Object.entries(optionNode.entries ?? {})) {
      const fieldMeta = resolveValibotFieldMeta(name, fieldSchema);
      variantFields.push(fieldMeta);

      // Add to all fields map (first occurrence wins for metadata)
      if (!allFieldsMap.has(name)) {
        allFieldsMap.set(name, fieldMeta);
      }
    }

    const variantDescription = extractDescription(optionNode);
    variants.push({
      discriminatorValue: getDiscriminatorValue(optionNode, discriminator),
      fields: variantFields,
      ...(variantDescription ? { description: variantDescription } : {}),
    });
  }

  const description = extractDescription(schema);
  return {
    fields: Array.from(allFieldsMap.values()),
    schema: schema as unknown as ArgsSchema,
    schemaType: "discriminatedUnion",
    unknownKeysMode: getUnknownKeysMode(schema),
    discriminator,
    variants,
    ...(description ? { description } : {}),
  };
}

/**
 * Extract fields from a union schema
 */
function extractFromUnion(schema: ValibotNode): ExtractedFields {
  const options = schema.options ?? [];

  const allFieldsMap = new Map<string, ResolvedFieldMeta>();
  const unionOptions: ExtractedFields[] = [];

  for (const option of options) {
    const extracted = extractValibotFields(option as ArgsSchema);
    unionOptions.push(extracted);

    for (const field of extracted.fields) {
      if (!allFieldsMap.has(field.name)) {
        allFieldsMap.set(field.name, field);
      }
    }
  }

  const description = extractDescription(schema);
  return {
    fields: Array.from(allFieldsMap.values()),
    schema: schema as unknown as ArgsSchema,
    schemaType: "union",
    unknownKeysMode: getUnknownKeysMode(schema),
    unionOptions,
    ...(description ? { description } : {}),
  };
}

/**
 * Extract fields from `v.intersect([...])`
 */
function extractFromIntersect(schema: ValibotNode): ExtractedFields {
  const allFieldsMap = new Map<string, ResolvedFieldMeta>();

  for (const option of schema.options ?? []) {
    const extracted = extractValibotFields(option as ArgsSchema);
    for (const field of extracted.fields) {
      if (!allFieldsMap.has(field.name)) {
        allFieldsMap.set(field.name, field);
      }
    }
  }

  const description = extractDescription(schema);
  return {
    fields: Array.from(allFieldsMap.values()),
    schema: schema as unknown as ArgsSchema,
    schemaType: "intersection",
    unknownKeysMode: getUnknownKeysMode(schema),
    ...(description ? { description } : {}),
  };
}

/**
 * Cache for extractValibotFields results to avoid redundant schema extraction
 */
const extractFieldsCache = new WeakMap<ArgsSchema, ExtractedFields>();

/**
 * Extract all fields from a valibot args schema
 * (object, strictObject, looseObject, variant, union, intersect)
 */
export function extractValibotFields(schema: ArgsSchema): ExtractedFields {
  const cached = extractFieldsCache.get(schema);
  if (cached) return cached;

  const node = asNode(schema);
  let result: ExtractedFields;

  switch (node.type) {
    case "object":
    case "strict_object":
    case "loose_object":
    case "object_with_rest": {
      const description = extractDescription(node);
      result = {
        fields: extractFromObject(node),
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(node),
        ...(description ? { description } : {}),
      };
      break;
    }

    case "variant":
      result = extractFromVariant(node);
      break;

    case "union":
      result = extractFromUnion(node);
      break;

    case "intersect":
      result = extractFromIntersect(node);
      break;

    default: {
      const description = extractDescription(node);
      // Fallback: treat as an empty object schema
      result = {
        fields: [],
        schema,
        schemaType: "object",
        unknownKeysMode: getUnknownKeysMode(node),
        ...(description ? { description } : {}),
      };
      break;
    }
  }

  extractFieldsCache.set(schema, result);
  return result;
}

/**
 * Structural view of a valibot issue (`BaseIssue`).
 *
 * `ValidationError.received` is filled from `issue.input` (the raw value at
 * the issue's path), not valibot's `issue.received`: the latter is a
 * pre-formatted display string (e.g. `'"nope"'`), while the zod adapter
 * reports the raw value — `input` keeps the two adapters' semantics aligned.
 */
interface ValibotIssue {
  type: string;
  message: string;
  input: unknown;
  expected: string | null;
  path?: Array<{ key?: unknown }> | undefined;
}

/**
 * Convert valibot issues to ValidationError array
 */
function formatValibotIssues(issues: readonly unknown[]): ValidationError[] {
  return issues.map((raw) => {
    const issue = raw as ValibotIssue;
    return {
      path: issue.path?.map((item) => String(item.key)) ?? [],
      message: issue.message,
      code: issue.type,
      received: issue.input,
      expected: issue.expected ?? undefined,
    };
  });
}

/**
 * Validate raw arguments against a valibot schema
 */
export function validateValibotArgs(
  rawArgs: Record<string, unknown>,
  schema: ArgsSchema,
): ValidationResult<unknown> {
  const result = safeParse(schema as unknown as GenericSchema, rawArgs);

  if (result.success) {
    return { success: true, data: result.output };
  }

  return {
    success: false,
    errors: formatValibotIssues(result.issues),
  };
}

/**
 * The valibot validator adapter.
 */
export const valibotAdapter: ValidatorAdapter = {
  vendor: "valibot",
  extractFields: extractValibotFields,
  resolveFieldMeta: resolveValibotFieldMeta,
  getUnknownKeysMode,
  validate: validateValibotArgs,
};
