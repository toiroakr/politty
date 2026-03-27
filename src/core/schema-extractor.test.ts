import { describe, expect, it } from "vitest";
import { z } from "zod";
import { extractFields, getUnknownKeysMode, toCamelCase } from "./schema-extractor.js";

describe("schema-extractor", () => {
  describe("getUnknownKeysMode", () => {
    it("should return 'strip' for default z.object()", () => {
      const schema = z.object({ name: z.string() });
      expect(getUnknownKeysMode(schema)).toBe("strip");
    });

    it("should return 'strict' for z.strictObject()", () => {
      const schema = z.strictObject({ name: z.string() });
      expect(getUnknownKeysMode(schema)).toBe("strict");
    });

    it("should return 'strict' for z.object().strict()", () => {
      const schema = z.object({ name: z.string() }).strict();
      expect(getUnknownKeysMode(schema)).toBe("strict");
    });

    it("should return 'passthrough' for z.looseObject()", () => {
      const schema = z.looseObject({ name: z.string() });
      expect(getUnknownKeysMode(schema)).toBe("passthrough");
    });

    it("should return 'passthrough' for z.object().passthrough()", () => {
      const schema = z.object({ name: z.string() }).passthrough();
      expect(getUnknownKeysMode(schema)).toBe("passthrough");
    });
  });

  describe("extractFields - unknownKeysMode", () => {
    it("should extract 'strip' mode for default z.object()", () => {
      const schema = z.object({ name: z.string() });
      const extracted = extractFields(schema);
      expect(extracted.unknownKeysMode).toBe("strip");
    });

    it("should extract 'strict' mode for z.strictObject()", () => {
      const schema = z.strictObject({ name: z.string() });
      const extracted = extractFields(schema);
      expect(extracted.unknownKeysMode).toBe("strict");
    });

    it("should extract 'passthrough' mode for z.looseObject()", () => {
      const schema = z.looseObject({ name: z.string() });
      const extracted = extractFields(schema);
      expect(extracted.unknownKeysMode).toBe("passthrough");
    });
  });

  describe("extractFields - transform (pipe)", () => {
    it("should detect field types through field-level transforms", () => {
      const schema = z.object({
        verbose: z
          .boolean()
          .optional()
          .transform((v) => !!v),
        count: z.coerce.number().transform((n) => n * 2),
      });
      const extracted = extractFields(schema);
      const verboseField = extracted.fields.find((f) => f.name === "verbose");
      const countField = extracted.fields.find((f) => f.name === "count");
      expect(verboseField?.type).toBe("boolean");
      expect(countField?.type).toBe("number");
    });

    it("should extract fields from object schema with transform", () => {
      const schema = z
        .object({
          port: z.coerce.number(),
          verbose: z.boolean().optional(),
        })
        .transform((args) => ({ ...args, computed: true }));
      const extracted = extractFields(schema);
      expect(extracted.fields.length).toBe(2);
      const portField = extracted.fields.find((f) => f.name === "port");
      const verboseField = extracted.fields.find((f) => f.name === "verbose");
      expect(portField?.type).toBe("number");
      expect(verboseField?.type).toBe("boolean");
    });
  });

  describe("toCamelCase", () => {
    it("should convert kebab-case to camelCase", () => {
      expect(toCamelCase("dry-run")).toBe("dryRun");
    });

    it("should convert multi-word kebab-case", () => {
      expect(toCamelCase("output-dir")).toBe("outputDir");
    });

    it("should handle multiple hyphens", () => {
      expect(toCamelCase("my-long-option-name")).toBe("myLongOptionName");
    });

    it("should return single words unchanged", () => {
      expect(toCamelCase("verbose")).toBe("verbose");
    });

    it("should return camelCase unchanged", () => {
      expect(toCamelCase("dryRun")).toBe("dryRun");
    });
  });

  describe("extractFields discriminatedUnion", () => {
    it("extracts discriminator value from z.enum() single-value discriminators", () => {
      const schema = z.discriminatedUnion("mode", [
        z.object({ mode: z.enum(["a"]), foo: z.string() }),
        z.object({ mode: z.enum(["b"]), bar: z.string() }),
      ]);
      const result = extractFields(schema);
      expect(result.schemaType).toBe("discriminatedUnion");
      expect(result.variants).toHaveLength(2);
      expect(result.variants![0]!.discriminatorValue).toBe("a");
      expect(result.variants![1]!.discriminatorValue).toBe("b");
    });
  });
});
