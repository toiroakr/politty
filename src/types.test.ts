import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import type { ArgDefinition, InferArgs } from "./types.js";

/**
 * Task 2.1: 引数定義の型システムのテスト
 * - zodスキーマを受け取り、メタデータを型安全に指定できる
 * - 必須引数とオプション引数を区別できる型推論
 * - IDEの補完が効くメタデータ型
 */
describe("Type System", () => {
  describe("ArgDefinition", () => {
    it("should accept zod schema with metadata", () => {
      const argDef: ArgDefinition<z.ZodString> = {
        schema: z.string(),
        alias: "n",
        description: "User name",
        positional: true,
        placeholder: "NAME",
      };

      expect(argDef.schema).toBeDefined();
      expect(argDef.alias).toBe("n");
      expect(argDef.description).toBe("User name");
      expect(argDef.positional).toBe(true);
      expect(argDef.placeholder).toBe("NAME");
    });

    it("should allow optional metadata fields", () => {
      const argDef: ArgDefinition = {
        schema: z.string(),
      };

      expect(argDef.schema).toBeDefined();
      expect(argDef.alias).toBeUndefined();
      expect(argDef.description).toBeUndefined();
      expect(argDef.positional).toBeUndefined();
    });

    it("should support boolean schemas with default", () => {
      const argDef: ArgDefinition<z.ZodDefault<z.ZodBoolean>> = {
        schema: z.boolean().default(false),
        alias: "v",
        description: "Enable verbose mode",
      };

      // In zod v4, defaultValue is accessed via .def.defaultValue (not a function)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((argDef.schema as any).def.defaultValue).toBe(false);
    });

    it("should support number schemas", () => {
      const argDef: ArgDefinition<z.ZodNumber> = {
        schema: z.number(),
        alias: "p",
        description: "Port number",
      };

      expect(argDef.schema).toBeDefined();
    });
  });

  describe("InferArgs", () => {
    it("should infer string type from z.string()", () => {
      type Args = InferArgs<{
        name: ArgDefinition<z.ZodString>;
      }>;

      expectTypeOf<Args["name"]>().toEqualTypeOf<string>();
    });

    it("should infer boolean type from z.boolean().default()", () => {
      type Args = InferArgs<{
        verbose: ArgDefinition<z.ZodDefault<z.ZodBoolean>>;
      }>;

      expectTypeOf<Args["verbose"]>().toEqualTypeOf<boolean>();
    });

    it("should infer number type from z.number()", () => {
      type Args = InferArgs<{
        port: ArgDefinition<z.ZodNumber>;
      }>;

      expectTypeOf<Args["port"]>().toEqualTypeOf<number>();
    });

    it("should infer optional type from z.string().optional()", () => {
      type Args = InferArgs<{
        config: ArgDefinition<z.ZodOptional<z.ZodString>>;
      }>;

      expectTypeOf<Args["config"]>().toEqualTypeOf<string | undefined>();
    });

    it("should infer transformed type", () => {
      type Args = InferArgs<{
        port: ArgDefinition<z.ZodEffects<z.ZodString, number, string>>;
      }>;

      expectTypeOf<Args["port"]>().toEqualTypeOf<number>();
    });

    it("should infer multiple args correctly", () => {
      type Args = InferArgs<{
        name: ArgDefinition<z.ZodString>;
        verbose: ArgDefinition<z.ZodDefault<z.ZodBoolean>>;
        port: ArgDefinition<z.ZodOptional<z.ZodNumber>>;
      }>;

      expectTypeOf<Args>().toEqualTypeOf<{
        name: string;
        verbose: boolean;
        port: number | undefined;
      }>();
    });
  });

  describe("Required vs Optional distinction", () => {
    it("should distinguish required from optional by schema", () => {
      const requiredArg: ArgDefinition = {
        schema: z.string(),
        description: "Required argument",
      };

      const optionalArg: ArgDefinition = {
        schema: z.string().optional(),
        description: "Optional argument",
      };

      const defaultArg: ArgDefinition = {
        schema: z.string().default("default"),
        description: "Argument with default",
      };

      // Runtime check: required schema is not optional
      expect(requiredArg.schema.isOptional()).toBe(false);
      expect(optionalArg.schema.isOptional()).toBe(true);
      expect(defaultArg.schema.isOptional()).toBe(true); // default makes it optional
    });
  });
});
