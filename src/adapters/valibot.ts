/**
 * Native Valibot schema adapter.
 *
 * Introspects Valibot schemas by reading their internal structure directly
 * (`.entries`, `.options`, `.wrapped`, `.default`, `.pipe`, `.key`, ...) instead
 * of converting to JSON Schema. This needs only `valibot` itself — no
 * `@standard-community/standard-json` / `@valibot/to-json-schema` — and is
 * synchronous (no `prepare` step). Registered by importing `politty/valibot`.
 *
 * Validation still flows through the Standard Schema `~standard.validate`
 * interface, identical to the generic adapter.
 */

import type { z } from "zod";
import { getArgMeta as getArgMetaFromRegistry } from "../core/arg-registry.js";
import {
  buildFieldMeta,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "../core/field-meta.js";
import type { SchemaAdapter } from "../core/schema-registry.js";
import { unwrapStandardSchema } from "../core/standard-schema.js";
import type { ArgsSchema } from "../types.js";
import { validateStandard } from "../validator/standard-validator.js";

/** Minimal view of a Valibot schema/action node (internal, duck-typed). */
interface VNode {
  readonly kind?: string;
  readonly type?: string;
  readonly entries?: Record<string, VNode>;
  readonly wrapped?: VNode;
  readonly default?: unknown;
  readonly options?: readonly VNode[] | readonly unknown[];
  readonly literal?: unknown;
  readonly enum?: Record<string, unknown>;
  readonly key?: string;
  readonly item?: VNode;
  readonly pipe?: readonly VNode[];
  readonly description?: string;
}

/** Wrappers whose presence at the top makes an object key optional (absent ok). */
const OPTIONAL_WRAPPERS: ReadonlySet<string> = new Set([
  "optional",
  "exact_optional",
  "nullish",
  "undefinedable",
]);

/** All single-child wrapper schema types (unwrapped via `.wrapped`). */
const WRAPPERS: ReadonlySet<string> = new Set([
  "optional",
  "exact_optional",
  "nullish",
  "undefinedable",
  "nullable",
  "non_optional",
  "non_nullable",
  "non_nullish",
]);

const node = (schema: unknown): VNode => schema as VNode;

/**
 * Strip wrappers (and resolve a pipe to its output schema) to reach the schema
 * that determines a field's base type / enum values.
 */
function effective(schema: unknown): VNode {
  let s = node(schema);
  while (s && typeof s.type === "string" && WRAPPERS.has(s.type) && s.wrapped) {
    s = node(s.wrapped);
  }
  if (s && Array.isArray(s.pipe)) {
    // A piped schema's output type is its last schema-kind stage (e.g.
    // pipe(string, transform(Number), number) → number).
    const schemas = s.pipe.filter((stage) => node(stage).kind === "schema");
    const last = schemas[schemas.length - 1];
    if (last) s = node(last);
  }
  return s;
}

function valibotBaseType(schema: unknown): ResolvedFieldMeta["type"] {
  const eff = effective(schema);
  switch (eff?.type) {
    case "string":
    case "picklist":
    case "enum":
      return "string";
    case "literal":
      return typeof eff.literal === "string" ? "string" : "unknown";
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

function valibotEnumValues(schema: unknown): string[] | undefined {
  const eff = effective(schema);
  if (eff?.type === "picklist" && Array.isArray(eff.options)) {
    const strings = eff.options.filter((o): o is string => typeof o === "string");
    if (strings.length === eff.options.length && strings.length > 0) return strings;
  }
  if (eff?.type === "enum" && eff.enum && typeof eff.enum === "object") {
    const values = Object.values(eff.enum).filter((v): v is string => typeof v === "string");
    if (values.length > 0) return values;
  }
  if (eff?.type === "array" && eff.item) {
    return valibotEnumValues(eff.item);
  }
  if (eff?.type === "union" && Array.isArray(eff.options)) {
    const literals: string[] = [];
    for (const option of eff.options) {
      const opt = effective(option);
      if (opt?.type === "literal" && typeof opt.literal === "string") literals.push(opt.literal);
    }
    if (literals.length === eff.options.length && literals.length > 0) return literals;
  }
  return undefined;
}

/** Optional when the top-level wrapper allows the key to be absent. */
function valibotIsOptional(schema: unknown): boolean {
  const t = node(schema).type;
  return typeof t === "string" && OPTIONAL_WRAPPERS.has(t);
}

function valibotDefault(schema: unknown): unknown {
  const s = node(schema);
  if (!("default" in s)) return undefined;
  const d = s.default;
  return typeof d === "function" ? (d as () => unknown)() : d;
}

/** Description from a `v.description()` metadata action in the schema's pipe. */
function valibotDescription(schema: unknown): string | undefined {
  let s = node(schema);
  while (s && typeof s.type === "string" && WRAPPERS.has(s.type) && s.wrapped) {
    s = node(s.wrapped);
  }
  if (s && Array.isArray(s.pipe)) {
    for (const stage of s.pipe) {
      const st = node(stage);
      if (st.type === "description" && typeof st.description === "string") return st.description;
    }
  }
  return undefined;
}

function valibotUnknownKeysMode(type: string | undefined): UnknownKeysMode {
  if (type === "strict_object") return "strict";
  if (type === "loose_object" || type === "object_with_rest") return "passthrough";
  return "strip";
}

function resolveValibotField(name: string, fieldSchema: unknown): ResolvedFieldMeta {
  const argMeta =
    getArgMetaFromRegistry(fieldSchema as object) ??
    getArgMetaFromRegistry(unwrapStandardSchema(fieldSchema) as object);
  return buildFieldMeta(name, argMeta, {
    description: valibotDescription(fieldSchema),
    type: valibotBaseType(fieldSchema),
    required: !valibotIsOptional(fieldSchema),
    defaultValue: valibotDefault(fieldSchema),
    enumValues: valibotEnumValues(fieldSchema),
    schema: fieldSchema as unknown as z.ZodType,
  });
}

function objectFields(objSchema: VNode): ResolvedFieldMeta[] {
  const entries = objSchema.entries ?? {};
  return Object.entries(entries).map(([name, fieldSchema]) =>
    resolveValibotField(name, fieldSchema),
  );
}

/** Single-valued string literal value of a (possibly wrapped) literal schema. */
function literalString(schema: unknown): string | undefined {
  const eff = effective(schema);
  if (
    eff?.type === "literal" &&
    (typeof eff.literal === "string" || typeof eff.literal === "number")
  ) {
    return String(eff.literal);
  }
  return undefined;
}

function mergeFields(lists: ResolvedFieldMeta[][]): ResolvedFieldMeta[] {
  const merged = new Map<string, ResolvedFieldMeta>();
  for (const list of lists) {
    for (const field of list) if (!merged.has(field.name)) merged.set(field.name, field);
  }
  return Array.from(merged.values());
}

/** Detect a discriminator shared by every union branch as a distinct literal. */
function detectDiscriminator(
  options: readonly VNode[],
): { discriminator: string; values: string[] } | undefined {
  if (options.length < 2) return undefined;
  const firstEntries = effective(options[0]).entries;
  if (!firstEntries) return undefined;
  for (const key of Object.keys(firstEntries)) {
    const values: string[] = [];
    let ok = true;
    for (const option of options) {
      const entries = effective(option).entries;
      const value = entries ? literalString(entries[key]) : undefined;
      if (value === undefined) {
        ok = false;
        break;
      }
      values.push(value);
    }
    if (ok && new Set(values).size === values.length) return { discriminator: key, values };
  }
  return undefined;
}

function extractValibot(schema: ArgsSchema): ExtractedFields {
  const eff = effective(schema);
  const type = eff?.type;

  // Discriminated union (v.variant) — discriminator is exposed as `.key`.
  if (type === "variant" && Array.isArray(eff.options)) {
    const options = eff.options as VNode[];
    const discriminator = eff.key ?? "";
    const branchFields = options.map((option) => objectFields(effective(option)));
    const variants = options.map((option, i) => {
      const entries = effective(option).entries ?? {};
      const discriminatorValue = literalString(entries[discriminator]) ?? "";
      return { discriminatorValue, fields: branchFields[i]! };
    });
    return {
      fields: mergeFields(branchFields),
      schema,
      schemaType: "discriminatedUnion",
      unknownKeysMode: "strip",
      discriminator,
      variants,
    };
  }

  // Union — discriminated when a shared literal key is detectable, else plain.
  if (type === "union" && Array.isArray(eff.options)) {
    const options = eff.options as VNode[];
    const branchFields = options.map((option) => objectFields(effective(option)));
    const disc = detectDiscriminator(options);
    if (disc) {
      const variants = options.map((_, i) => ({
        discriminatorValue: disc.values[i]!,
        fields: branchFields[i]!,
      }));
      return {
        fields: mergeFields(branchFields),
        schema,
        schemaType: "discriminatedUnion",
        unknownKeysMode: "strip",
        discriminator: disc.discriminator,
        variants,
      };
    }
    return {
      fields: mergeFields(branchFields),
      schema,
      schemaType: "union",
      unknownKeysMode: "strip",
      unionOptions: options.map((_, i) => ({
        fields: branchFields[i]!,
        schema,
        schemaType: "object" as const,
        unknownKeysMode: "strip" as const,
      })),
    };
  }

  // Intersection — merge fields from every operand.
  if (type === "intersect" && Array.isArray(eff.options)) {
    const options = eff.options as VNode[];
    return {
      fields: mergeFields(options.map((option) => objectFields(effective(option)))),
      schema,
      schemaType: "intersection",
      unknownKeysMode: "strip",
    };
  }

  // Object (default).
  return {
    fields: objectFields(eff),
    schema,
    schemaType: "object",
    unknownKeysMode: valibotUnknownKeysMode(type),
  };
}

/**
 * Schema adapter for Valibot. Register it by importing `politty/valibot`.
 */
export const valibotAdapter: SchemaAdapter = {
  vendors: ["valibot"],
  extractFields: extractValibot,
  resolveField: resolveValibotField,
  validate: (rawArgs, schema) => validateStandard(rawArgs, schema),
};
