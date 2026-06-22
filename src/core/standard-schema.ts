/**
 * Standard Schema integration.
 *
 * politty's core is built around schema introspection (see schema-extractor.ts).
 * Zod exposes its structure directly via internal `_def`, but other libraries
 * (Valibot, ArkType, ...) only implement the {@link https://standardschema.dev/
 * Standard Schema} interface, which provides validation but no structural
 * introspection.
 *
 * To bridge that gap we convert non-Zod schemas to JSON Schema (via the
 * community `@standard-community/standard-json` package) and extract fields
 * from the JSON Schema instead. Per-field metadata registered through `arg()`
 * is still recovered by walking the *original* schema's child objects, which
 * both Valibot (`.entries`) and ArkType (`.get()`) expose by stable reference.
 *
 * IMPORTANT: nothing in this module imports `zod` at runtime. Importing the
 * politty core for a Valibot/ArkType CLI must not pull Zod into the bundle.
 */

/**
 * Minimal JSON Schema shape (draft-07 / draft-2020-12) covering the keywords
 * politty inspects. Intentionally loose — we only read a handful of fields.
 */
export interface JsonSchema {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema | JsonSchema[];
  enum?: unknown[];
  const?: unknown;
  default?: unknown;
  description?: string;
  additionalProperties?: boolean | JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  [key: string]: unknown;
}

/** A value that implements the Standard Schema interface. */
export interface StandardSchemaLike {
  readonly "~standard": {
    readonly version: number;
    readonly vendor: string;
    readonly validate: (value: unknown) =>
      | { value: unknown; issues?: undefined }
      | {
          issues: ReadonlyArray<{
            message: string;
            path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
          }>;
        }
      | PromiseLike<
          | { value: unknown; issues?: undefined }
          | {
              issues: ReadonlyArray<{
                message: string;
                path?: ReadonlyArray<PropertyKey | { key: PropertyKey }>;
              }>;
            }
        >;
  };
}

/**
 * Get the Standard Schema vendor name (e.g. "zod", "valibot", "arktype").
 * Returns undefined for values that do not implement the interface.
 */
export function getVendor(schema: unknown): string | undefined {
  const std = (schema as Partial<StandardSchemaLike> | null | undefined)?.["~standard"];
  return std && typeof std === "object" ? std.vendor : undefined;
}

/** Whether a schema is a Zod schema (handled by the native introspection path). */
export function isZodSchema(schema: unknown): boolean {
  return getVendor(schema) === "zod";
}

/** Whether a schema implements the Standard Schema interface. */
export function isStandardSchema(schema: unknown): schema is StandardSchemaLike {
  return getVendor(schema) !== undefined;
}

// ---------------------------------------------------------------------------
// JSON Schema conversion (lazy, vendor-agnostic via @standard-community/standard-json)
// ---------------------------------------------------------------------------

interface StandardJsonModule {
  toJsonSchema: {
    (schema: unknown, options?: unknown): Promise<JsonSchema>;
    sync: (schema: unknown, options?: unknown) => JsonSchema;
  };
}

// Specifier kept in a variable so it is treated as an external optional peer
// dependency rather than something that must resolve at build time.
const STANDARD_JSON_PACKAGE = "@standard-community/standard-json";

let modulePromise: Promise<StandardJsonModule> | undefined;
let loadedModule: StandardJsonModule | undefined;

async function loadStandardJson(): Promise<StandardJsonModule> {
  if (!modulePromise) {
    modulePromise = import(STANDARD_JSON_PACKAGE).then(
      (m) => {
        loadedModule = m as unknown as StandardJsonModule;
        return loadedModule;
      },
      () => {
        modulePromise = undefined;
        throw new Error(
          `politty: to use a non-Zod schema (vendor detected via Standard Schema), install "${STANDARD_JSON_PACKAGE}" and the matching converter (e.g. "@valibot/to-json-schema" for Valibot, "arktype" for ArkType).`,
        );
      },
    );
  }
  return modulePromise;
}

/** Cache of JSON Schema keyed by the original schema object. */
const jsonSchemaCache = new WeakMap<object, JsonSchema>();

/**
 * Vendor-specific conversion options that keep introspection working for the
 * common CLI pattern of string→value coercion, which is not representable in
 * JSON Schema and would otherwise make conversion throw or produce unusable
 * output.
 *
 * - Valibot: `errorMode: "ignore"` skips unsupported pipe actions (transforms).
 * - ArkType: a catch-all `fallback` replaces unsupported nodes (e.g. coercion
 *   morphs) with their input base, preserving a usable input type.
 */
function conversionOptions(vendor: string | undefined): Record<string, unknown> | undefined {
  switch (vendor) {
    case "valibot":
      return { errorMode: "ignore" };
    case "arktype":
      return { fallback: (ctx: { base?: unknown }) => ctx?.base ?? {} };
    default:
      return undefined;
  }
}

/**
 * Asynchronously convert a non-Zod schema to JSON Schema and cache it.
 *
 * Must be awaited before the synchronous {@link getJsonSchema} /
 * `extractFields` pipeline runs for that schema. Calling it also populates the
 * underlying converter's internal map so later synchronous conversions work.
 * No-op for Zod schemas, politty's built-in internal schemas, and
 * already-prepared schemas.
 */
export async function prepareSchema(schema: unknown): Promise<void> {
  if (!isStandardSchema(schema) || isZodSchema(schema)) return;
  // politty's built-in internal schema is introspected directly and needs no
  // JSON Schema conversion.
  if (getVendor(schema) === "politty") return;
  if (jsonSchemaCache.has(schema as object)) return;
  const mod = await loadStandardJson();
  const json = await mod.toJsonSchema(schema, conversionOptions(getVendor(schema)));
  jsonSchemaCache.set(schema as object, json);
}

/**
 * Synchronously get the JSON Schema for a previously-prepared schema.
 *
 * Falls back to the converter's synchronous path when available (works for
 * vendors whose converter is already loaded, e.g. after a prior
 * {@link prepareSchema}). Throws a descriptive error otherwise.
 */
export function getJsonSchema(schema: unknown): JsonSchema {
  const cached = jsonSchemaCache.get(schema as object);
  if (cached) return cached;

  // Best-effort synchronous conversion. Works when the converter module and the
  // vendor producer are already loaded process-wide (e.g. ArkType, or Valibot
  // after a prior async prepareSchema call).
  if (loadedModule) {
    try {
      const json = loadedModule.toJsonSchema.sync(schema, conversionOptions(getVendor(schema)));
      jsonSchemaCache.set(schema as object, json);
      return json;
    } catch {
      // Fall through to the descriptive error below.
    }
  }

  throw new Error(
    "politty: schema was not prepared for synchronous introspection. " +
      "This usually means runMain/runCommand did not pre-convert it. " +
      "Call `prepareSchema(schema)` (awaited) before extracting fields.",
  );
}

// ---------------------------------------------------------------------------
// Original-schema child access (for recovering arg() metadata per field)
// ---------------------------------------------------------------------------

interface ValibotObjectLike {
  readonly type?: string;
  readonly entries?: Record<string, unknown>;
  readonly wrapped?: unknown;
  readonly options?: readonly unknown[];
}

interface ArkTypeLike {
  get?: (key: string) => unknown;
}

/**
 * Valibot composite schema types whose `.options` array holds the original
 * sub-schemas, used to recover per-field `arg()` metadata inside the branches
 * of a union / variant / intersection.
 */
const VALIBOT_COMPOSITES: ReadonlySet<string> = new Set(["union", "variant", "intersect"]);

/**
 * Recover the original sub-schemas of a composite schema (union / discriminated
 * union / intersection), in declaration order, so `arg()` metadata stored by
 * reference on each branch's fields can be looked up.
 *
 * Returns undefined when the vendor does not expose stable, order-preserving
 * branch references (e.g. ArkType, whose JSON Schema branch order is not
 * guaranteed to match its internal order); callers then fall back to
 * JSON-Schema-only field info without `arg()` recovery.
 */
export function getUnionOptionSchemas(schema: unknown): readonly unknown[] | undefined {
  if (getVendor(schema) === "valibot") {
    const s = schema as ValibotObjectLike;
    if (typeof s.type === "string" && VALIBOT_COMPOSITES.has(s.type) && Array.isArray(s.options)) {
      return s.options;
    }
  }
  return undefined;
}

/**
 * Wrapper schema types (Valibot) whose `.wrapped` inner schema may carry the
 * `arg()` metadata when the user wrote e.g. `v.optional(arg(v.string()), ...)`.
 */
const VALIBOT_WRAPPERS: ReadonlySet<string> = new Set([
  "optional",
  "exact_optional",
  "nullable",
  "nullish",
  "non_optional",
  "non_nullable",
  "non_nullish",
  "undefinedable",
]);

/**
 * Recover the original child schema object for a top-level field, by vendor.
 * Used only to look up `arg()` metadata stored by reference; returns undefined
 * when the vendor does not expose stable child references.
 */
export function getChildSchema(schema: unknown, fieldName: string): unknown {
  const vendor = getVendor(schema);
  if (vendor === "valibot") {
    const entry = (schema as ValibotObjectLike).entries?.[fieldName];
    return entry;
  }
  if (vendor === "arktype") {
    const getter = (schema as ArkTypeLike).get;
    if (typeof getter === "function") {
      try {
        return getter.call(schema, fieldName);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Unwrap a Valibot wrapper schema (optional/nullable/...) to its inner schema,
 * so `arg()` metadata stored on the inner schema can be found. Returns the
 * input unchanged for non-wrapper or non-Valibot schemas.
 */
export function unwrapStandardSchema(schema: unknown): unknown {
  const s = schema as ValibotObjectLike | null | undefined;
  if (s && typeof s === "object" && typeof s.type === "string" && VALIBOT_WRAPPERS.has(s.type)) {
    if ("wrapped" in s && s.wrapped) {
      return unwrapStandardSchema(s.wrapped);
    }
  }
  return schema;
}
