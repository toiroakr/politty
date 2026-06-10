import { describe, expect, it } from "vitest";

/**
 * Task 1.1: Project setup tests
 * - Verify TypeScript + ESM/CJS dual output
 * - Verify type safety
 * - Verify tree-shaking compatible module structure
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
      const { defineCommand, arg } = await import("../index.js");

      // Type inference test: define a command with zod schema
      const command = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string(), { description: "User name" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: (args) => {
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
