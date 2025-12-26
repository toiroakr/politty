import { describe, expect, it } from "vitest";
import { z } from "zod";
import { validateArgs } from "./zod-validator.js";

/**
 * Task 5.1: Zod validator tests
 * - Validate parsed args with zod schema
 * - Apply default values
 * - Execute transform/refine
 * - Collect validation errors
 */
describe("ZodValidator", () => {
  describe("validateArgs", () => {
    it("should validate string args", () => {
      const schema = z.object({
        name: z.string(),
      });

      const result = validateArgs({ name: "John" }, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.name).toBe("John");
      }
    });

    it("should apply default values", () => {
      const schema = z.object({
        verbose: z.boolean().default(false),
      });

      const result = validateArgs({}, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.verbose).toBe(false);
      }
    });

    it("should apply transform", () => {
      const schema = z.object({
        port: z.string().transform((s) => parseInt(s, 10)),
      });

      const result = validateArgs({ port: "8080" }, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8080);
      }
    });

    it("should validate with refine", () => {
      const schema = z.object({
        count: z.number().refine((n) => n > 0, "Must be positive"),
      });

      const result = validateArgs({ count: -1 }, schema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0]?.message).toContain("positive");
      }
    });

    it("should collect all validation errors", () => {
      const schema = z.object({
        name: z.string().min(1),
        age: z.number().positive(),
      });

      const result = validateArgs({ name: "", age: -5 }, schema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      }
    });

    it("should handle missing required args", () => {
      const schema = z.object({
        required: z.string(),
      });

      const result = validateArgs({}, schema);

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.errors[0]?.path).toContain("required");
      }
    });

    it("should handle optional args", () => {
      const schema = z.object({
        optional: z.string().optional(),
      });

      const result = validateArgs({}, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.optional).toBeUndefined();
      }
    });

    it("should validate number coercion", () => {
      const schema = z.object({
        port: z.coerce.number(),
      });

      const result = validateArgs({ port: "8080" }, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.port).toBe(8080);
      }
    });

    it("should validate enum values", () => {
      const schema = z.object({
        level: z.enum(["debug", "info", "error"]),
      });

      const result = validateArgs({ level: "info" }, schema);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.level).toBe("info");
      }
    });

    it("should fail on invalid enum value", () => {
      const schema = z.object({
        level: z.enum(["debug", "info", "error"]),
      });

      const result = validateArgs({ level: "invalid" }, schema);

      expect(result.success).toBe(false);
    });

    it("should provide error details", () => {
      const schema = z.object({
        email: z.string().email(),
      });

      const result = validateArgs({ email: "not-an-email" }, schema);

      expect(result.success).toBe(false);
      if (!result.success) {
        const error = result.errors[0];
        expect(error?.path).toContain("email");
        expect(error?.code).toBeDefined();
        expect(error?.message).toBeDefined();
      }
    });

    it("should validate discriminated union", () => {
      const schema = z.discriminatedUnion("type", [
        z.object({ type: z.literal("a"), value: z.string() }),
        z.object({ type: z.literal("b"), count: z.number() }),
      ]);

      const resultA = validateArgs({ type: "a", value: "hello" }, schema);
      expect(resultA.success).toBe(true);
      if (resultA.success) {
        expect(resultA.data.type).toBe("a");
      }

      const resultB = validateArgs({ type: "b", count: 42 }, schema);
      expect(resultB.success).toBe(true);
      if (resultB.success) {
        expect(resultB.data.type).toBe("b");
      }
    });
  });
});
