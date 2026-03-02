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
});
