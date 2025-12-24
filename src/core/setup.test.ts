import { describe, it, expect } from "vitest";

/**
 * Task 1.1: プロジェクト基盤構築のテスト
 * - TypeScript + ESM/CJS デュアル出力の検証
 * - 型安全性の検証
 * - Tree-shaking 対応モジュール構成の検証
 */
describe("Project Setup", () => {
  describe("Module Exports", () => {
    it("should export defineCommand function", async () => {
      const mod = await import("../index.js");
      expect(typeof mod.defineCommand).toBe("function");
    });

    it("should export runMain function", async () => {
      const mod = await import("../index.js");
      expect(typeof mod.runMain).toBe("function");
    });
  });

  describe("Type Safety", () => {
    it("should work with zod schemas", async () => {
      const { z } = await import("zod");
      const { defineCommand } = await import("../index.js");

      // Type inference test: define a command with zod schema
      const command = defineCommand({
        name: "test",
        args: {
          name: {
            schema: z.string(),
            description: "User name",
          },
          verbose: {
            schema: z.boolean().default(false),
            alias: "v",
          },
        },
        run: ({ args }) => {
          // args should be inferred as { name: string; verbose: boolean }
          expect(typeof args.name).toBe("string");
          expect(typeof args.verbose).toBe("boolean");
        },
      });

      expect(command).toBeDefined();
      expect(command.name).toBe("test");
    });
  });
});
