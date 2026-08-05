/**
 * Minimal, validator-free args descriptors for politty's own internal
 * commands (`completion`, `skills`, `__complete`, the `politty` bin, ...).
 *
 * politty's user-facing API is schema-library-driven (zod today), but the
 * framework's built-in commands must not force a schema library into the
 * user's import graph — a CLI that only installs the valibot adapter should
 * never load zod because it mounted the completion command. Internal
 * commands therefore describe their (deliberately simple: string / boolean /
 * enum / string-array) args with these descriptors, which core can extract
 * and validate on its own.
 *
 * Not exported from the package entry points — this is an internal tool,
 * not a third supported schema flavor.
 */

import type { ArgMeta, BuiltinOverrideArgMeta, RegularArgMeta } from "../core/arg-registry.js";
import type { ArgsSchema } from "../types.js";
import {
  resolveFieldMeta,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "./field-meta.js";
import type { ValidationError, ValidationResult } from "./types.js";

/** Runtime brand distinguishing internal descriptors from library schemas. */
const INTERNAL_ARGS_BRAND = "__polittyInternalArgs";

type InternalFieldKind = "string" | "boolean" | "enum" | "string-array";

interface InternalFieldSpec {
  kind: InternalFieldKind;
  /** Allowed values (enum kind only) */
  enumValues?: readonly string[] | undefined;
  /** Whether omitting the value is allowed without a default */
  optional: boolean;
  /** Default applied when the value is missing */
  defaultValue?: unknown;
  /**
   * arg()-style metadata (description, positional, alias, ...).
   * Stored as `ArgMeta<any>`: `ArgMeta`'s `effect` callback makes the type
   * contravariant in its value parameter, so the precisely-typed metas the
   * builders accept only unify under `any`.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  meta?: ArgMeta<any> | undefined;
}

/**
 * A single internal field descriptor. `TOut` is the phantom output type
 * used by {@link internalArgs} to give `defineCommand`'s `run` a precisely
 * typed args object.
 */
export interface InternalField<TOut> extends InternalFieldSpec {
  readonly __out?: TOut;
}

/**
 * An internal args schema. The `& ArgsSchema` half is a deliberate
 * type-level fiction: the runtime object has none of a schema library's
 * methods, but presenting it as an {@link ArgsSchema} lets internal
 * commands flow through `defineCommand` and `Command<...>` without widening
 * politty's public types. Nothing ever calls schema methods on it — the
 * extract/validate facades check {@link isInternalArgsSchema} first.
 */
export type InternalArgsSchema<TOut extends Record<string, unknown> = Record<string, unknown>> = {
  readonly [INTERNAL_ARGS_BRAND]: true;
  readonly fields: Record<string, InternalFieldSpec>;
  readonly unknownKeys: UnknownKeysMode;
  readonly __out?: TOut;
} & ArgsSchema;

/** Infer the validated output type of an {@link internalArgs} descriptor. */
export type InferInternalArgs<S> = S extends { readonly __out?: infer TOut }
  ? NonNullable<TOut>
  : never;

type FieldsOut<TFields extends Record<string, InternalField<unknown>>> = {
  [K in keyof TFields]: TFields[K] extends InternalField<infer O> ? O : never;
};

/** Metadata accepted by internal field builders (same shape as `arg()`). */
type InternalMeta<TValue> = RegularArgMeta<TValue> | BuiltinOverrideArgMeta<TValue>;

/**
 * Field builders for {@link internalArgs}. Only the shapes internal
 * commands actually need; extend deliberately, not speculatively.
 */
export const internalField = {
  /** Required string */
  string(meta?: InternalMeta<string>): InternalField<string> {
    return { kind: "string", optional: false, meta };
  },
  /** Optional string (undefined when omitted) */
  optionalString(meta?: InternalMeta<string | undefined>): InternalField<string | undefined> {
    return { kind: "string", optional: true, meta };
  },
  /** Boolean flag defaulting to false */
  boolean(meta?: InternalMeta<boolean>): InternalField<boolean> {
    return { kind: "boolean", optional: false, defaultValue: false, meta };
  },
  /** Required enum */
  enum<const TValues extends readonly [string, ...string[]]>(
    values: TValues,
    meta?: InternalMeta<TValues[number]>,
  ): InternalField<TValues[number]> {
    return { kind: "enum", enumValues: values, optional: false, meta };
  },
  /** Optional enum (undefined when omitted) */
  optionalEnum<const TValues extends readonly [string, ...string[]]>(
    values: TValues,
    meta?: InternalMeta<TValues[number] | undefined>,
  ): InternalField<TValues[number] | undefined> {
    return { kind: "enum", enumValues: values, optional: true, meta };
  },
  /** String array defaulting to [] */
  stringArray(meta?: InternalMeta<string[]>): InternalField<string[]> {
    return { kind: "string-array", optional: false, defaultValue: [], meta };
  },
  /** Optional string array (undefined when omitted) */
  optionalStringArray(
    meta?: InternalMeta<string[] | undefined>,
  ): InternalField<string[] | undefined> {
    return { kind: "string-array", optional: true, meta };
  },
};

/**
 * Build an internal args schema from field descriptors.
 */
export function internalArgs<TFields extends Record<string, InternalField<unknown>>>(
  fields: TFields,
  options: { unknownKeys?: UnknownKeysMode } = {},
): InternalArgsSchema<FieldsOut<TFields>> {
  const schema = {
    [INTERNAL_ARGS_BRAND]: true,
    fields,
    unknownKeys: options.unknownKeys ?? "strip",
  };
  return schema as unknown as InternalArgsSchema<FieldsOut<TFields>>;
}

/**
 * Runtime check for the internal descriptor brand. The extract/validate
 * facades call this before falling back to the schema-library adapter.
 */
export function isInternalArgsSchema(schema: unknown): schema is InternalArgsSchema {
  return (
    typeof schema === "object" &&
    schema !== null &&
    (schema as Record<string, unknown>)[INTERNAL_ARGS_BRAND] === true
  );
}

const FIELD_TYPE: Record<InternalFieldKind, ResolvedFieldMeta["type"]> = {
  string: "string",
  boolean: "boolean",
  enum: "string",
  "string-array": "array",
};

const extractCache = new WeakMap<InternalArgsSchema, ExtractedFields>();

/**
 * Extract neutral field metadata from an internal args schema.
 */
export function extractInternalFields(schema: InternalArgsSchema): ExtractedFields {
  const cached = extractCache.get(schema);
  if (cached) return cached;

  const fields = Object.entries(schema.fields).map(([name, spec]) =>
    resolveFieldMeta(name, {
      argMeta: spec.meta,
      description: undefined,
      required: !spec.optional && spec.defaultValue === undefined,
      defaultValue: spec.defaultValue,
      type: FIELD_TYPE[spec.kind],
      enumValues: spec.enumValues ? [...spec.enumValues] : undefined,
      schema: spec,
    }),
  );

  const result: ExtractedFields = {
    fields,
    schema,
    schemaType: "object",
    unknownKeysMode: schema.unknownKeys,
  };
  extractCache.set(schema, result);
  return result;
}

function expectedLabel(spec: InternalFieldSpec): string {
  return spec.kind === "enum"
    ? `one of ${(spec.enumValues ?? []).map((v) => JSON.stringify(v)).join(" | ")}`
    : spec.kind;
}

function receivedLabel(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function typeError(name: string, spec: InternalFieldSpec, received: unknown): ValidationError {
  return {
    path: [name],
    message: `Invalid input: expected ${expectedLabel(spec)}, received ${receivedLabel(received)}`,
    code: "invalid_type",
    received,
    expected: expectedLabel(spec),
  };
}

function checkValue(name: string, spec: InternalFieldSpec, value: unknown): ValidationError | null {
  switch (spec.kind) {
    case "string":
      return typeof value === "string" ? null : typeError(name, spec, value);
    case "boolean":
      return typeof value === "boolean" ? null : typeError(name, spec, value);
    case "enum":
      if (typeof value !== "string" || !(spec.enumValues ?? []).includes(value)) {
        return {
          path: [name],
          message: `Invalid option: expected ${expectedLabel(spec)}`,
          code: "invalid_value",
          received: value,
          expected: expectedLabel(spec),
        };
      }
      return null;
    case "string-array":
      if (!Array.isArray(value) || value.some((v) => typeof v !== "string")) {
        return typeError(name, spec, value);
      }
      return null;
  }
}

/**
 * Validate raw parsed args against an internal args schema. Mirrors the
 * schema-library semantics the parser relies on: defaults fill missing
 * values, optional fields stay absent, and unknown keys follow the
 * descriptor's `unknownKeys` mode (strip by default, like z.object()).
 */
export function validateInternalArgs(
  rawArgs: Record<string, unknown>,
  schema: InternalArgsSchema,
): ValidationResult<Record<string, unknown>> {
  const errors: ValidationError[] = [];
  const data: Record<string, unknown> = {};

  for (const [name, spec] of Object.entries(schema.fields)) {
    const value = rawArgs[name];
    if (value === undefined) {
      if (spec.defaultValue !== undefined) {
        // Copy array defaults so one invocation can't mutate the shared spec
        data[name] = Array.isArray(spec.defaultValue) ? [...spec.defaultValue] : spec.defaultValue;
      } else if (!spec.optional) {
        errors.push(typeError(name, spec, undefined));
      }
      continue;
    }
    const error = checkValue(name, spec, value);
    if (error) {
      errors.push(error);
      continue;
    }
    data[name] = value;
  }

  const knownNames = new Set(Object.keys(schema.fields));
  const unknownKeys = Object.keys(rawArgs).filter((key) => !knownNames.has(key));
  if (unknownKeys.length > 0) {
    if (schema.unknownKeys === "strict") {
      errors.push({
        path: [],
        message: `Unrecognized key${unknownKeys.length > 1 ? "s" : ""}: ${unknownKeys
          .map((k) => JSON.stringify(k))
          .join(", ")}`,
        code: "unrecognized_keys",
      });
    } else if (schema.unknownKeys === "passthrough") {
      for (const key of unknownKeys) {
        data[key] = rawArgs[key];
      }
    }
    // strip: drop silently
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }
  return { success: true, data };
}
