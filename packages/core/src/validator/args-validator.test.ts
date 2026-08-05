import { describe, expect, it } from "vitest";
import { z } from "zod";
import { internalArgs, internalField } from "../adapter/internal-args.js";
import { validateArgs } from "./args-validator.js";

/**
 * Task 5.1: Zod validator tests
 * - Validate parsed args with zod schema
 * - Apply default values
 * - Execute transform/refine
 * - Collect validation errors
 */
describe("args-validator (zod schemas)", () => {
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

describe("args-validator (internal args schemas)", () => {
  const schema = internalArgs({
    shell: internalField.enum(["bash", "zsh", "fish"]),
    out: internalField.optionalString(),
    verify: internalField.boolean(),
    exclude: internalField.stringArray(),
  });

  it("should route internal schemas past the zod adapter and apply defaults", () => {
    const result = validateArgs({ shell: "bash" }, schema);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({ shell: "bash", verify: false, exclude: [] });
    }
  });

  it("should report missing required fields with the neutral ValidationError shape", () => {
    const result = validateArgs({}, schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors).toEqual([
        {
          path: ["shell"],
          message: 'Invalid input: expected one of "bash" | "zsh" | "fish", received undefined',
          code: "invalid_type",
          received: undefined,
          expected: 'one of "bash" | "zsh" | "fish"',
        },
      ]);
    }
  });

  it("should reject values outside the enum", () => {
    const result = validateArgs({ shell: "powershell" }, schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatchObject({
        path: ["shell"],
        code: "invalid_value",
        received: "powershell",
      });
    }
  });

  it("should label array type errors like zod", () => {
    const result = validateArgs({ shell: "bash", exclude: "not-an-array" }, schema);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatchObject({
        path: ["exclude"],
        message: "Invalid input: expected array, received string",
      });
    }
  });

  it("should strip unknown keys by default", () => {
    const result = validateArgs({ shell: "zsh", unknown: "x" }, schema);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty("unknown");
    }
  });

  it("should reject unknown keys in strict mode", () => {
    const strict = internalArgs(
      { shell: internalField.enum(["bash", "zsh", "fish"]) },
      { unknownKeys: "strict" },
    );
    const result = validateArgs({ shell: "bash", extra: 1 }, strict);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors[0]).toMatchObject({ code: "unrecognized_keys" });
    }
  });

  it("should keep __proto__ as an own key in passthrough mode", () => {
    const passthrough = internalArgs(
      { shell: internalField.enum(["bash", "zsh", "fish"]) },
      { unknownKeys: "passthrough" },
    );
    // An object literal's `__proto__:` is prototype syntax, not an own key,
    // so build the raw args the way a hostile parser output would look.
    const raw: Record<string, unknown> = { shell: "bash", other: "kept" };
    Object.defineProperty(raw, "__proto__", {
      value: "polluted",
      enumerable: true,
      writable: true,
      configurable: true,
    });
    const result = validateArgs(raw, passthrough);

    expect(result.success).toBe(true);
    if (result.success) {
      const data = result.data as Record<string, unknown>;
      expect(Object.hasOwn(data, "__proto__")).toBe(true);
      expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
      expect(data.other).toBe("kept");
    }
  });
});
