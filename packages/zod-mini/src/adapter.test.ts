import { describe, expect, it } from "vitest";
import * as z from "zod/mini";

import { arg } from "@politty/core/core/arg-registry";
import {
  extractEnumValues,
  extractZodMiniFields,
  getUnknownKeysMode,
  resolveZodMiniFieldMeta,
  validateZodMiniArgs,
} from "./adapter.js";

describe("zod/mini adapter", () => {
  describe("getUnknownKeysMode", () => {
    it("should return 'strip' for default z.object()", () => {
      expect(getUnknownKeysMode(z.object({ name: z.string() }))).toBe("strip");
    });

    it("should return 'strict' for z.strictObject()", () => {
      expect(getUnknownKeysMode(z.strictObject({ name: z.string() }))).toBe("strict");
    });

    it("should return 'passthrough' for z.looseObject()", () => {
      expect(getUnknownKeysMode(z.looseObject({ name: z.string() }))).toBe("passthrough");
    });

    it("should see through wrappers and pipes to the wrapped object's mode", () => {
      expect(getUnknownKeysMode(z.optional(z.strictObject({ name: z.string() })))).toBe("strict");
      expect(
        getUnknownKeysMode(
          z.pipe(
            z.looseObject({ name: z.string() }),
            z.transform((x) => x),
          ),
        ),
      ).toBe("passthrough");
    });
  });

  describe("extractZodMiniFields - wrapper handling", () => {
    it("should extract fields through a defaulted wrapper", () => {
      // A defaulted wrapper keeps an object output type, so this type-checks
      // as an args schema. Before unwrapping, extraction fell through to the
      // fallback and returned no fields at all — positionals were rejected
      // and help/docs/completion came out empty.
      const schema = z._default(z.object({ name: z.string(), dryRun: z.boolean() }), {
        name: "x",
        dryRun: false,
      });
      const extracted = extractZodMiniFields(schema);
      expect(extracted.fields.map((f) => f.name)).toEqual(["name", "dryRun"]);
      expect(extracted.schemaType).toBe("object");
      // The wrapper itself is kept so validation still applies it.
      expect(extracted.schema).toBe(schema);
    });

    it("should keep the original schema for wrapped composites", () => {
      // Extraction unwraps to find the fields, but ExtractedFields.schema is
      // the schema validation runs against — for a wrapped composite the
      // wrapper is what carries the default, so it must not be replaced by
      // the unwrapped inner schema.
      const discriminatedUnion = z._default(
        z.discriminatedUnion("t", [
          z.object({ t: z.literal("a"), x: z.string() }),
          z.object({ t: z.literal("b"), y: z.string() }),
        ]),
        { t: "a" as const, x: "" },
      );
      const union = z._default(
        z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
        { a: "" },
      );
      const intersection = z._default(
        z.intersection(z.object({ a: z.string() }), z.object({ b: z.string() })),
        { a: "", b: "" },
      );

      for (const [label, schema] of [
        ["discriminatedUnion", discriminatedUnion],
        ["union", union],
        ["intersection", intersection],
      ] as const) {
        const extracted = extractZodMiniFields(schema);
        expect(extracted.schema, label).toBe(schema);
        expect(extracted.fields.length, label).toBeGreaterThan(0);
      }
    });
  });

  describe("extractZodMiniFields - basic types", () => {
    it("should extract string, number, boolean, and array fields", () => {
      const schema = z.object({
        name: z.string(),
        count: z.number(),
        verbose: z.boolean(),
        tags: z.array(z.string()),
      });

      const extracted = extractZodMiniFields(schema);
      expect(extracted.schemaType).toBe("object");
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("name")?.type).toBe("string");
      expect(byName.get("count")?.type).toBe("number");
      expect(byName.get("verbose")?.type).toBe("boolean");
      expect(byName.get("tags")?.type).toBe("array");
    });

    it("should convert camelCase field names to kebab-case cliName", () => {
      const schema = z.object({ dryRun: z.boolean(), outputDir: z.string() });
      const extracted = extractZodMiniFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("dryRun")?.cliName).toBe("dry-run");
      expect(byName.get("outputDir")?.cliName).toBe("output-dir");
    });

    it("should mark plain fields required and optional/default fields not required", () => {
      const schema = z.object({
        required: z.string(),
        optional: z.optional(z.string()),
        withDefault: z._default(z.string(), "x"),
      });
      const extracted = extractZodMiniFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("required")?.required).toBe(true);
      expect(byName.get("optional")?.required).toBe(false);
      expect(byName.get("withDefault")?.required).toBe(false);
    });

    it("should keep nullable (without optional) required, matching CLI semantics", () => {
      const schema = z.object({ maybe: z.nullable(z.string()) });
      const extracted = extractZodMiniFields(schema);
      expect(extracted.fields[0]?.required).toBe(true);
    });

    it("should extract default values, invoking factory defaults", () => {
      const schema = z.object({
        level: z._default(z.string(), "info"),
        tags: z._default(z.array(z.string()), () => ["a"]),
      });
      const extracted = extractZodMiniFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("level")?.defaultValue).toBe("info");
      expect(byName.get("tags")?.defaultValue).toEqual(["a"]);
      expect(byName.get("level")?.required).toBe(false);
    });

    it("should detect enum values from z.enum() and literal unions", () => {
      const schema = z.object({
        level: z.enum(["debug", "info", "warn"]),
        levels: z.array(z.enum(["a", "b"])),
        lit: z.union([z.literal("x"), z.literal("y")]),
      });
      const extracted = extractZodMiniFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("level")?.enumValues).toEqual(["debug", "info", "warn"]);
      expect(byName.get("level")?.type).toBe("string");
      expect(byName.get("levels")?.enumValues).toEqual(["a", "b"]);
      expect(byName.get("lit")?.enumValues).toEqual(["x", "y"]);
    });

    it("should detect number type through z.coerce.number()", () => {
      const schema = z.object({
        port: z.coerce.number(),
      });
      const extracted = extractZodMiniFields(schema);
      expect(extracted.fields[0]?.type).toBe("number");
    });
  });

  describe("extractZodMiniFields - descriptions and metadata", () => {
    it("should read descriptions registered via .register(z.globalRegistry, ...), recursing into wrappers", () => {
      const direct = z.string();
      z.globalRegistry.add(direct, { description: "direct desc" });
      const wrappedInner = z.string();
      z.globalRegistry.add(wrappedInner, { description: "wrapped desc" });

      const schema = z.object({
        direct,
        wrapped: z._default(wrappedInner, "x"),
      });
      const extracted = extractZodMiniFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("direct")?.description).toBe("direct desc");
      expect(byName.get("wrapped")?.description).toBe("wrapped desc");
    });

    it("should read arg() metadata from the politty registry", () => {
      const schema = z.object({
        name: arg(z.string(), { alias: "n", positional: true }),
      });
      const extracted = extractZodMiniFields(schema);
      expect(extracted.fields[0]?.alias).toEqual(["n"]);
      expect(extracted.fields[0]?.positional).toBe(true);
    });

    it("should prioritize arg() registry metadata over globalRegistry metadata", () => {
      const base = z.string();
      z.globalRegistry.add(base, { description: "registry desc" });
      const schema = z.object({
        name: arg(base, { description: "arg desc", alias: "n" }),
      });
      const extracted = extractZodMiniFields(schema);
      expect(extracted.fields[0]?.description).toBe("arg desc");
      expect(extracted.fields[0]?.alias).toEqual(["n"]);
    });

    it("should validate negation is only allowed on boolean fields", () => {
      const schema = z.object({
        name: arg(z.string(), { negation: true } as never),
      });
      expect(() => extractZodMiniFields(schema)).toThrow(/negation can only be used on boolean/);
    });
  });

  describe("extractZodMiniFields - discriminated union", () => {
    it("should extract discriminator, variants, and merged fields", () => {
      const schema = z.discriminatedUnion("action", [
        z.object({
          action: z.literal("create"),
          name: z.string(),
        }),
        z.object({
          action: z.literal("delete"),
          id: z.coerce.number(),
        }),
      ]);

      const extracted = extractZodMiniFields(schema);
      expect(extracted.schemaType).toBe("discriminatedUnion");
      expect(extracted.discriminator).toBe("action");
      expect(extracted.variants?.map((x) => x.discriminatorValue)).toEqual(["create", "delete"]);
      expect(extracted.fields.map((f) => f.name)).toEqual(["action", "name", "id"]);
    });
  });

  describe("extractZodMiniFields - union and intersection", () => {
    it("should extract union options", () => {
      const schema = z.union([z.object({ a: z.string() }), z.object({ b: z.number() })]);
      const extracted = extractZodMiniFields(schema);
      expect(extracted.schemaType).toBe("union");
      expect(extracted.unionOptions).toHaveLength(2);
      expect(extracted.fields.map((f) => f.name)).toEqual(["a", "b"]);
    });

    it("should merge intersection member fields", () => {
      const schema = z.intersection(z.object({ a: z.string() }), z.object({ b: z.boolean() }));
      const extracted = extractZodMiniFields(schema);
      expect(extracted.schemaType).toBe("intersection");
      expect(extracted.fields.map((f) => f.name)).toEqual(["a", "b"]);
    });
  });

  describe("resolveZodMiniFieldMeta", () => {
    it("should resolve a single field schema without an object wrapper", () => {
      const meta = resolveZodMiniFieldMeta(
        "logLevel",
        arg(z._default(z.enum(["debug", "info"]), "info"), { alias: "L" }),
      );
      expect(meta.cliName).toBe("log-level");
      expect(meta.alias).toEqual(["L"]);
      expect(meta.enumValues).toEqual(["debug", "info"]);
      expect(meta.defaultValue).toBe("info");
      expect(meta.required).toBe(false);
    });
  });

  describe("extractEnumValues", () => {
    it("should return undefined for non-enum schemas", () => {
      expect(extractEnumValues(z.string())).toBeUndefined();
      expect(extractEnumValues(z.union([z.literal("a"), z.string()]))).toBeUndefined();
    });
  });

  describe("validateZodMiniArgs", () => {
    it("should return typed data on success", () => {
      const schema = z.object({
        name: z.string(),
        count: z._default(z.number(), 1),
      });
      const result = validateZodMiniArgs({ name: "x" }, schema);
      expect(result).toEqual({ success: true, data: { name: "x", count: 1 } });
    });

    it("should report rich errors with path, code, and expected", () => {
      const schema = z.object({
        level: z.enum(["debug", "info"]),
        count: z.number(),
      });
      const result = validateZodMiniArgs({ level: "nope", count: "NaN" }, schema);
      expect(result.success).toBe(false);
      if (result.success) return;

      const byPath = new Map(result.errors.map((e) => [e.path.join("."), e]));
      const levelError = byPath.get("level");
      expect(levelError?.code).toBe("invalid_value");
      const countError = byPath.get("count");
      expect(countError?.code).toBe("invalid_type");
      expect(countError?.expected).toBe("number");
    });

    it("should report nested paths for array element errors", () => {
      const schema = z.object({ tags: z.array(z.string()) });
      const result = validateZodMiniArgs({ tags: ["ok", 1] }, schema);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errors[0]?.path).toEqual(["tags", "1"]);
    });

    it("should reject unknown keys for strictObject", () => {
      const schema = z.strictObject({ name: z.string() });
      const result = validateZodMiniArgs({ name: "x", extra: 1 }, schema);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errors[0]?.code).toBe("unrecognized_keys");
    });

    it("should pass unknown keys through for looseObject", () => {
      const schema = z.looseObject({ name: z.string() });
      const result = validateZodMiniArgs({ name: "x", extra: 1 }, schema);
      expect(result).toEqual({ success: true, data: { name: "x", extra: 1 } });
    });

    it("should validate discriminated union schemas by discriminator", () => {
      const schema = z.discriminatedUnion("action", [
        z.object({ action: z.literal("create"), name: z.string() }),
        z.object({ action: z.literal("delete"), id: z.number() }),
      ]);
      const ok = validateZodMiniArgs({ action: "delete", id: 3 }, schema);
      expect(ok).toEqual({ success: true, data: { action: "delete", id: 3 } });

      const bad = validateZodMiniArgs({ action: "delete", id: "x" }, schema);
      expect(bad.success).toBe(false);
    });
  });
});
