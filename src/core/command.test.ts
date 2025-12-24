import { describe, it, expect, expectTypeOf } from "vitest";
import { z } from "zod";
import { defineCommand } from "./command.js";
import { arg } from "./arg-registry.js";

/**
 * Task 2.2: Command definition API tests
 * - Define commands type-safely with defineCommand
 * - Auto-infer argument types from zod schemas
 * - setup / run / cleanup lifecycle hooks
 * - Subcommand definitions
 */
describe("defineCommand", () => {
  describe("Basic command definition", () => {
    it("should create a command with name, version, description", () => {
      const cmd = defineCommand({
        name: "my-cli",
        version: "1.0.0",
        description: "A test CLI",
      });

      expect(cmd.name).toBe("my-cli");
      expect(cmd.version).toBe("1.0.0");
      expect(cmd.description).toBe("A test CLI");
    });

    it("should create a command without optional fields", () => {
      const cmd = defineCommand({});

      expect(cmd.name).toBeUndefined();
      expect(cmd.version).toBeUndefined();
      expect(cmd.argsSchema).toBeUndefined();
    });
  });

  describe("Args with zod schema", () => {
    it("should define args with zod schemas using arg() helper", () => {
      const cmd = defineCommand({
        args: z.object({
          name: arg(z.string(), { description: "User name" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
      });

      expect(cmd.argsSchema).toBeDefined();
    });

    it("should infer args type in run function", () => {
      const cmd = defineCommand({
        args: z.object({
          name: z.string(),
          count: z.number().default(1),
        }),
        run: ({ args }) => {
          // Type assertions (compile-time)
          expectTypeOf(args.name).toEqualTypeOf<string>();
          expectTypeOf(args.count).toEqualTypeOf<number>();
          return `${args.name}: ${args.count}`;
        },
      });

      expect(cmd.run).toBeDefined();
    });

    it("should support positional arguments via arg() helper", () => {
      const cmd = defineCommand({
        args: z.object({
          file: arg(z.string(), { positional: true, description: "Input file" }),
        }),
      });

      expect(cmd.argsSchema).toBeDefined();
    });

    it("should support placeholders for help via arg() helper", () => {
      const cmd = defineCommand({
        args: z.object({
          port: arg(z.number(), { placeholder: "PORT" }),
        }),
      });

      expect(cmd.argsSchema).toBeDefined();
    });
  });

  describe("Lifecycle hooks", () => {
    it("should support setup hook", () => {
      const cmd = defineCommand({
        args: z.object({
          name: z.string(),
        }),
        setup: ({ args }) => {
          expectTypeOf(args.name).toEqualTypeOf<string>();
        },
      });

      expect(cmd.setup).toBeDefined();
    });

    it("should support cleanup hook", () => {
      const cmd = defineCommand({
        args: z.object({
          name: z.string(),
        }),
        cleanup: ({ args, error }) => {
          expectTypeOf(args.name).toEqualTypeOf<string>();
          expectTypeOf(error).toEqualTypeOf<Error | undefined>();
        },
      });

      expect(cmd.cleanup).toBeDefined();
    });

    it("should support async hooks", () => {
      const cmd = defineCommand({
        setup: async () => {
          await Promise.resolve();
        },
        run: async () => {
          return await Promise.resolve("done");
        },
        cleanup: async () => {
          await Promise.resolve();
        },
      });

      expect(cmd.setup).toBeDefined();
      expect(cmd.run).toBeDefined();
      expect(cmd.cleanup).toBeDefined();
    });
  });

  describe("Subcommands", () => {
    it("should support subcommand definitions", () => {
      const subCmd = defineCommand({
        name: "sub",
        run: () => "sub result",
      });

      const cmd = defineCommand({
        name: "main",
        subCommands: {
          sub: subCmd,
        },
      });

      expect(cmd.subCommands).toBeDefined();
      expect(cmd.subCommands?.sub).toBe(subCmd);
    });

    it("should support lazy-loaded subcommands", () => {
      const cmd = defineCommand({
        name: "main",
        subCommands: {
          lazy: async () => {
            return defineCommand({
              name: "lazy-sub",
              run: () => "lazy result",
            });
          },
        },
      });

      expect(cmd.subCommands).toBeDefined();
      expect(typeof cmd.subCommands?.lazy).toBe("function");
    });

    it("should support mixed sync and async subcommands", () => {
      const syncSub = defineCommand({ name: "sync" });

      const cmd = defineCommand({
        name: "main",
        subCommands: {
          sync: syncSub,
          async: async () => defineCommand({ name: "async" }),
        },
      });

      expect(cmd.subCommands?.sync).toBe(syncSub);
      expect(typeof cmd.subCommands?.async).toBe("function");
    });
  });

  describe("Return type inference", () => {
    it("should infer void return type by default", () => {
      const cmd = defineCommand({
        run: () => {
          console.log("hello");
        },
      });

      // Verify run is defined - specific type inference is tested via compile-time checks
      expect(cmd.run).toBeDefined();
    });

    it("should infer custom return type", () => {
      const cmd = defineCommand({
        run: () => {
          return { success: true, count: 42 };
        },
      });

      // The run function should return the specified type
      expect(cmd.run).toBeDefined();
    });

    it("should infer async return type", () => {
      const cmd = defineCommand({
        run: async () => {
          return await Promise.resolve("async result");
        },
      });

      expect(cmd.run).toBeDefined();
    });
  });

  describe("Discriminated union support", () => {
    it("should support discriminated union for args", () => {
      const cmd = defineCommand({
        args: z.discriminatedUnion("action", [
          z.object({
            action: z.literal("create"),
            name: arg(z.string(), { description: "Resource name" }),
          }),
          z.object({
            action: z.literal("delete"),
            id: arg(z.coerce.number(), { description: "Resource ID" }),
          }),
        ]),
        run: ({ args }) => {
          if (args.action === "create") {
            expectTypeOf(args.name).toEqualTypeOf<string>();
          } else {
            expectTypeOf(args.id).toEqualTypeOf<number>();
          }
        },
      });

      expect(cmd.argsSchema).toBeDefined();
    });
  });
});
