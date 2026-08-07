import * as v from "valibot";
import { describe, expect, it } from "vitest";

import { arg } from "@politty/core/core/arg-registry";
import {
  extractEnumValues,
  extractValibotFields,
  getUnknownKeysMode,
  resolveValibotFieldMeta,
  validateValibotArgs,
} from "./adapter.js";

describe("valibot adapter", () => {
  describe("getUnknownKeysMode", () => {
    it("should return 'strip' for default v.object()", () => {
      expect(getUnknownKeysMode(v.object({ name: v.string() }))).toBe("strip");
    });

    it("should return 'strict' for v.strictObject()", () => {
      expect(getUnknownKeysMode(v.strictObject({ name: v.string() }))).toBe("strict");
    });

    it("should return 'passthrough' for v.looseObject()", () => {
      expect(getUnknownKeysMode(v.looseObject({ name: v.string() }))).toBe("passthrough");
    });

    it("should return 'passthrough' for v.objectWithRest()", () => {
      expect(getUnknownKeysMode(v.objectWithRest({ name: v.string() }, v.string()))).toBe(
        "passthrough",
      );
    });

    it("should see through wrappers and pipes to the wrapped object's mode", () => {
      expect(getUnknownKeysMode(v.optional(v.strictObject({ name: v.string() })))).toBe("strict");
      expect(
        getUnknownKeysMode(
          v.pipe(
            v.looseObject({ name: v.string() }),
            v.transform((x) => x),
          ),
        ),
      ).toBe("passthrough");
    });
  });

  describe("extractValibotFields - wrapper handling", () => {
    it("should extract fields through a defaulted wrapper", () => {
      // A defaulted wrapper keeps an object output type, so this type-checks
      // as an args schema. Before unwrapping, extraction fell through to the
      // fallback and returned no fields at all — positionals were rejected
      // and help/docs/completion came out empty.
      const schema = v.optional(v.object({ name: v.string(), dryRun: v.boolean() }), {
        name: "x",
        dryRun: false,
      });
      const extracted = extractValibotFields(schema);
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
      const variant = v.optional(
        v.variant("t", [
          v.object({ t: v.literal("a"), x: v.string() }),
          v.object({ t: v.literal("b"), y: v.string() }),
        ]),
        { t: "a" as const, x: "" },
      );
      const union = v.optional(
        v.union([v.object({ a: v.string() }), v.object({ b: v.string() })]),
        { a: "" },
      );
      const intersect = v.optional(
        v.intersect([v.object({ a: v.string() }), v.object({ b: v.string() })]),
        { a: "", b: "" },
      );

      for (const [label, schema] of [
        ["variant", variant],
        ["union", union],
        ["intersect", intersect],
      ] as const) {
        const extracted = extractValibotFields(schema);
        expect(extracted.schema, label).toBe(schema);
        expect(extracted.fields.length, label).toBeGreaterThan(0);
      }
    });
  });

  describe("extractValibotFields - basic types", () => {
    it("should extract string, number, boolean, and array fields", () => {
      const schema = v.object({
        name: v.string(),
        count: v.number(),
        verbose: v.boolean(),
        tags: v.array(v.string()),
      });

      const extracted = extractValibotFields(schema);
      expect(extracted.schemaType).toBe("object");
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("name")?.type).toBe("string");
      expect(byName.get("count")?.type).toBe("number");
      expect(byName.get("verbose")?.type).toBe("boolean");
      expect(byName.get("tags")?.type).toBe("array");
    });

    it("should convert camelCase field names to kebab-case cliName", () => {
      const schema = v.object({ dryRun: v.boolean(), outputDir: v.string() });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("dryRun")?.cliName).toBe("dry-run");
      expect(byName.get("outputDir")?.cliName).toBe("output-dir");
    });

    it("should mark plain fields required and optional fields not required", () => {
      const schema = v.object({
        required: v.string(),
        optional: v.optional(v.string()),
        nullish: v.nullish(v.string()),
        exactOptional: v.exactOptional(v.string()),
      });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("required")?.required).toBe(true);
      expect(byName.get("optional")?.required).toBe(false);
      expect(byName.get("nullish")?.required).toBe(false);
      expect(byName.get("exactOptional")?.required).toBe(false);
    });

    it("should keep nullable (without optional) required, matching the zod adapter", () => {
      const schema = v.object({ maybe: v.nullable(v.string()) });
      const extracted = extractValibotFields(schema);
      expect(extracted.fields[0]?.required).toBe(true);
    });

    it("should extract default values, invoking factory defaults", () => {
      const schema = v.object({
        level: v.optional(v.string(), "info"),
        tags: v.optional(v.array(v.string()), () => ["a"]),
      });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("level")?.defaultValue).toBe("info");
      expect(byName.get("tags")?.defaultValue).toEqual(["a"]);
      expect(byName.get("level")?.required).toBe(false);
    });

    it("should not report partial enum values for mixed-type picklists and numeric enums", () => {
      enum Numeric {
        One = 1,
        Two = 2,
      }
      const schema = v.object({
        mixed: v.picklist(["a", 1]),
        numeric: v.enum(Numeric),
      });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("mixed")?.enumValues).toBeUndefined();
      expect(byName.get("numeric")?.enumValues).toBeUndefined();
    });

    it("should detect enum values from picklist and enum schemas", () => {
      enum Fruit {
        Apple = "apple",
        Banana = "banana",
      }
      const schema = v.object({
        level: v.picklist(["debug", "info", "warn"]),
        fruit: v.enum(Fruit),
        levels: v.array(v.picklist(["a", "b"])),
        lit: v.union([v.literal("x"), v.literal("y")]),
      });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("level")?.enumValues).toEqual(["debug", "info", "warn"]);
      expect(byName.get("level")?.type).toBe("string");
      expect(byName.get("fruit")?.enumValues).toEqual(["apple", "banana"]);
      expect(byName.get("levels")?.enumValues).toEqual(["a", "b"]);
      expect(byName.get("lit")?.enumValues).toEqual(["x", "y"]);
    });

    it("should detect number type through the unknown+transform coercion pipe", () => {
      const schema = v.object({
        port: v.pipe(v.unknown(), v.transform(Number), v.number()),
      });
      const extracted = extractValibotFields(schema);
      expect(extracted.fields[0]?.type).toBe("number");
    });

    it("should detect number type from numeric-only validation actions without v.number()", () => {
      const schema = v.object({
        times: v.pipe(v.unknown(), v.transform(Number), v.integer()),
        every: v.pipe(v.unknown(), v.transform(Number), v.multipleOf(2)),
      });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("times")?.type).toBe("number");
      expect(byName.get("every")?.type).toBe("number");
    });

    it("should not treat a bigint multipleOf as a number field", () => {
      // v.multipleOf is overloaded for number and bigint under the same
      // action type, so only its requirement distinguishes them.
      const schema = v.object({
        big: v.pipe(
          v.unknown(),
          v.transform((value) => BigInt(String(value))),
          v.multipleOf(2n),
        ),
      });
      const extracted = extractValibotFields(schema);
      expect(extracted.fields[0]?.type).toBe("unknown");
    });

    it("should detect the input-side type of a transforming pipe", () => {
      const schema = v.object({
        flag: v.pipe(
          v.boolean(),
          v.transform((b) => (b ? "on" : "off")),
        ),
      });
      const extracted = extractValibotFields(schema);
      expect(extracted.fields[0]?.type).toBe("boolean");
    });
  });

  describe("extractValibotFields - descriptions and metadata", () => {
    it("should read v.description() pipe actions, recursing into wrappers", () => {
      const schema = v.object({
        direct: v.pipe(v.string(), v.description("direct desc")),
        wrapped: v.optional(v.pipe(v.string(), v.description("wrapped desc")), "x"),
      });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("direct")?.description).toBe("direct desc");
      expect(byName.get("wrapped")?.description).toBe("wrapped desc");
    });

    it("should read arg() metadata from v.metadata() pipe actions", () => {
      const schema = v.object({
        name: v.pipe(v.string(), v.metadata({ description: "meta desc", positional: true })),
      });
      const extracted = extractValibotFields(schema);
      expect(extracted.fields[0]?.description).toBe("meta desc");
      expect(extracted.fields[0]?.positional).toBe(true);
    });

    it("should find arg() metadata registered on the base schema of a pipe", () => {
      const schema = v.object({
        name: v.pipe(
          arg(v.string(), { alias: "n", positional: true }),
          v.transform((s) => s.trim()),
        ),
        wrapped: v.optional(
          v.pipe(arg(v.string(), { alias: "w" }), v.description("wrapped desc")),
          "x",
        ),
      });
      const extracted = extractValibotFields(schema);
      const byName = new Map(extracted.fields.map((f) => [f.name, f]));
      expect(byName.get("name")?.alias).toEqual(["n"]);
      expect(byName.get("name")?.positional).toBe(true);
      expect(byName.get("wrapped")?.alias).toEqual(["w"]);
    });

    it("should prioritize arg() registry metadata over pipe metadata", () => {
      const schema = v.object({
        name: arg(v.pipe(v.string(), v.description("pipe desc")), {
          description: "arg desc",
          alias: "n",
        }),
      });
      const extracted = extractValibotFields(schema);
      expect(extracted.fields[0]?.description).toBe("arg desc");
      expect(extracted.fields[0]?.alias).toEqual(["n"]);
    });

    it("should validate negation is only allowed on boolean fields", () => {
      const schema = v.object({
        name: arg(v.string(), { negation: true } as never),
      });
      expect(() => extractValibotFields(schema)).toThrow(/negation can only be used on boolean/);
    });
  });

  describe("extractValibotFields - variant (discriminated union)", () => {
    it("should extract discriminator, variants, and merged fields", () => {
      const schema = v.variant("action", [
        v.object({
          action: v.literal("create"),
          name: v.string(),
        }),
        v.object({
          action: v.literal("delete"),
          id: v.pipe(v.unknown(), v.transform(Number), v.number()),
        }),
      ]);

      const extracted = extractValibotFields(schema);
      expect(extracted.schemaType).toBe("discriminatedUnion");
      expect(extracted.discriminator).toBe("action");
      expect(extracted.variants?.map((x) => x.discriminatorValue)).toEqual(["create", "delete"]);
      expect(extracted.fields.map((f) => f.name)).toEqual(["action", "name", "id"]);
    });

    it("should support single-value picklist discriminators", () => {
      const schema = v.variant("mode", [
        v.object({ mode: v.picklist(["a"]), x: v.string() }),
        v.object({ mode: v.literal("b"), y: v.string() }),
      ]);
      const extracted = extractValibotFields(schema);
      expect(extracted.variants?.map((x) => x.discriminatorValue)).toEqual(["a", "b"]);
    });
  });

  describe("extractValibotFields - union and intersect", () => {
    it("should extract union options", () => {
      const schema = v.union([v.object({ a: v.string() }), v.object({ b: v.number() })]);
      const extracted = extractValibotFields(schema);
      expect(extracted.schemaType).toBe("union");
      expect(extracted.unionOptions).toHaveLength(2);
      expect(extracted.fields.map((f) => f.name)).toEqual(["a", "b"]);
    });

    it("should merge intersect member fields", () => {
      const schema = v.intersect([v.object({ a: v.string() }), v.object({ b: v.boolean() })]);
      const extracted = extractValibotFields(schema);
      expect(extracted.schemaType).toBe("intersection");
      expect(extracted.fields.map((f) => f.name)).toEqual(["a", "b"]);
    });
  });

  describe("resolveValibotFieldMeta", () => {
    it("should resolve a single field schema without an object wrapper", () => {
      const meta = resolveValibotFieldMeta(
        "logLevel",
        arg(v.optional(v.picklist(["debug", "info"]), "info"), { alias: "L" }),
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
      expect(extractEnumValues(v.string())).toBeUndefined();
      expect(extractEnumValues(v.union([v.literal("a"), v.string()]))).toBeUndefined();
    });
  });

  describe("validateValibotArgs", () => {
    it("should return typed data on success", () => {
      const schema = v.object({
        name: v.string(),
        count: v.optional(v.number(), 1),
      });
      const result = validateValibotArgs({ name: "x" }, schema);
      expect(result).toEqual({ success: true, data: { name: "x", count: 1 } });
    });

    it("should report rich errors with path, code, received, and expected", () => {
      const schema = v.object({
        level: v.picklist(["debug", "info"]),
        count: v.number(),
      });
      const result = validateValibotArgs({ level: "nope", count: "NaN" }, schema);
      expect(result.success).toBe(false);
      if (result.success) return;

      const byPath = new Map(result.errors.map((e) => [e.path.join("."), e]));
      const levelError = byPath.get("level");
      expect(levelError?.code).toBe("picklist");
      expect(levelError?.received).toBe("nope");
      expect(levelError?.expected).toContain('"debug"');
      const countError = byPath.get("count");
      expect(countError?.code).toBe("number");
      expect(countError?.message).toMatch(/Expected number/);
    });

    it("should report nested paths for array element errors", () => {
      const schema = v.object({ tags: v.array(v.string()) });
      const result = validateValibotArgs({ tags: ["ok", 1] }, schema);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errors[0]?.path).toEqual(["tags", "1"]);
    });

    it("should reject unknown keys for strictObject", () => {
      const schema = v.strictObject({ name: v.string() });
      const result = validateValibotArgs({ name: "x", extra: 1 }, schema);
      expect(result.success).toBe(false);
      if (result.success) return;
      expect(result.errors[0]?.path).toEqual(["extra"]);
    });

    it("should pass unknown keys through for looseObject", () => {
      const schema = v.looseObject({ name: v.string() });
      const result = validateValibotArgs({ name: "x", extra: 1 }, schema);
      expect(result).toEqual({ success: true, data: { name: "x", extra: 1 } });
    });

    it("should validate variant schemas by discriminator", () => {
      const schema = v.variant("action", [
        v.object({ action: v.literal("create"), name: v.string() }),
        v.object({ action: v.literal("delete"), id: v.number() }),
      ]);
      const ok = validateValibotArgs({ action: "delete", id: 3 }, schema);
      expect(ok).toEqual({ success: true, data: { action: "delete", id: 3 } });

      const bad = validateValibotArgs({ action: "delete", id: "x" }, schema);
      expect(bad.success).toBe(false);
    });
  });
});
