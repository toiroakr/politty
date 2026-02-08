import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import { arg } from "./arg-registry.js";
import { createDefineCommand, defineCommand } from "./command.js";

/**
 * Task 2.2: Command definition API tests
 * - Define commands type-safely with defineCommand
 * - Auto-infer argument types from zod schemas
 * - setup / run / cleanup lifecycle hooks
 * - Subcommand definitions
 */
describe("defineCommand", () => {
  describe("Basic command definition", () => {
    it("should create a command with name and description", () => {
      const cmd = defineCommand({
        name: "my-cli",
        description: "A test CLI",
      });

      expect(cmd.name).toBe("my-cli");
      expect(cmd.description).toBe("A test CLI");
    });

    it("should create a command without optional fields", () => {
      const cmd = defineCommand({
        name: "minimal",
      });

      expect(cmd.name).toBe("minimal");
      expect(cmd.args).toBeUndefined();
    });
  });

  describe("Args with zod schema", () => {
    it("should define args with zod schemas using arg() helper", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string(), { description: "User name" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
      });

      expect(cmd.args).toBeDefined();
    });

    it("should infer args type in run function", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
          count: z.number().default(1),
        }),
        run: (args) => {
          // Type assertions (compile-time)
          expectTypeOf(args).not.toBeAny();
          expectTypeOf(args.name).toEqualTypeOf<string>();
          expectTypeOf(args.count).toEqualTypeOf<number>();
          return `${args.name}: ${args.count}`;
        },
      });

      expect(cmd.run).toBeDefined();
    });

    it("should support positional arguments via arg() helper", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          file: arg(z.string(), { positional: true, description: "Input file" }),
        }),
      });

      expect(cmd.args).toBeDefined();
    });

    it("should support placeholders for help via arg() helper", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          port: arg(z.number(), { placeholder: "PORT" }),
        }),
      });

      expect(cmd.args).toBeDefined();
    });
  });

  describe("Lifecycle hooks", () => {
    it("should support setup hook", () => {
      const cmd = defineCommand({
        name: "test",
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
        name: "test",
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
        name: "test",
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
        name: "test",
        run: () => {
          console.log("hello");
        },
      });

      // Verify run is defined - specific type inference is tested via compile-time checks
      expect(cmd.run).toBeDefined();
    });

    it("should infer custom return type", () => {
      const cmd = defineCommand({
        name: "test",
        run: () => {
          return { success: true, count: 42 };
        },
      });

      // The run function should return the specified type
      expect(cmd.run).toBeDefined();
    });

    it("should infer async return type", () => {
      const cmd = defineCommand({
        name: "test",
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
        name: "test",
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
        run: (args) => {
          if (args.action === "create") {
            expectTypeOf(args.name).toEqualTypeOf<string>();
          } else {
            expectTypeOf(args.id).toEqualTypeOf<number>();
          }
        },
      });

      expect(cmd.args).toBeDefined();
    });
  });

  describe("Run function type inference", () => {
    it("should have run as required property when defined", () => {
      const cmd = defineCommand({
        name: "test",
        run: () => 42,
      });

      // cmd.run is not optional - can be called directly
      const result = cmd.run({});
      expectTypeOf(result).toEqualTypeOf<number>();
    });

    it("should have run as undefined when not defined", () => {
      const cmd = defineCommand({
        name: "no-run",
      });

      // cmd.run is undefined
      expectTypeOf(cmd.run).toEqualTypeOf<undefined>();
      expect(cmd.run).toBeUndefined();
    });

    it("should correctly infer result type for async run", () => {
      const cmd = defineCommand({
        name: "test",
        run: async () => ({ success: true }),
      });

      const result = cmd.run({});
      expectTypeOf(result).toEqualTypeOf<Promise<{ success: boolean }>>();
    });

    it("should work with args schema and run", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
        run: (args) => {
          return `Hello, ${args.name}!`;
        },
      });

      // No context argument needed since original function doesn't use it
      const result = cmd.run({ name: "World" });
      expectTypeOf(result).toEqualTypeOf<string>();
    });

    it("should work with args schema but no run", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
        subCommands: {},
      });

      expectTypeOf(cmd.run).toEqualTypeOf<undefined>();
    });

    it("should infer args correctly when using arg() helper", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string(), { positional: true, description: "Name" }),
          count: arg(z.number().default(1), { alias: "c", description: "Count" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: (args) => {
          // Verify args is properly typed inside the callback (not any)
          expectTypeOf(args).not.toBeAny();
          expectTypeOf(args.name).toEqualTypeOf<string>();
          expectTypeOf(args.count).toEqualTypeOf<number>();
          expectTypeOf(args.verbose).toEqualTypeOf<boolean>();
          return `${args.name}: ${args.count}`;
        },
      });

      const result = cmd.run({ name: "test", count: 5, verbose: true });
      expect(result).toBe("test: 5");
    });
  });
});

describe("createDefineCommand", () => {
  type TestGlobalArgs = {
    verbose: boolean;
    config?: string;
  };

  it("should create a defineCommand function with global args type pre-applied", () => {
    const defineAppCommand = createDefineCommand<TestGlobalArgs>();

    const cmd = defineAppCommand({
      name: "test",
      args: z.object({
        output: arg(z.string().default("dist"), { alias: "o" }),
      }),
      run: (args) => {
        // Type test: args should have both command args and global args
        expectTypeOf(args.output).toEqualTypeOf<string>();
        expectTypeOf(args.verbose).toEqualTypeOf<boolean>();
        expectTypeOf(args.config).toEqualTypeOf<string | undefined>();
        return `${args.output}-${args.verbose}`;
      },
    });

    expect(cmd.name).toBe("test");
    expect(cmd.args).toBeDefined();
    expect(cmd.run).toBeDefined();
  });

  it("should work with non-runnable commands", () => {
    const defineAppCommand = createDefineCommand<TestGlobalArgs>();

    const cmd = defineAppCommand({
      name: "parent",
      subCommands: {
        child: defineCommand({
          name: "child",
          run: () => {},
        }),
      },
    });

    expect(cmd.name).toBe("parent");
    expect(cmd.subCommands?.child).toBeDefined();
  });

  it("should infer types correctly in setup and cleanup", () => {
    const defineAppCommand = createDefineCommand<TestGlobalArgs>();

    const cmd = defineAppCommand({
      name: "test",
      args: z.object({
        output: arg(z.string().default("dist")),
      }),
      setup: ({ args }) => {
        expectTypeOf(args.verbose).toEqualTypeOf<boolean>();
        expectTypeOf(args.output).toEqualTypeOf<string>();
      },
      run: (args) => {
        expectTypeOf(args.verbose).toEqualTypeOf<boolean>();
        return args.output;
      },
      cleanup: ({ args }) => {
        expectTypeOf(args.verbose).toEqualTypeOf<boolean>();
        expectTypeOf(args.output).toEqualTypeOf<string>();
      },
    });

    expect(cmd.setup).toBeDefined();
    expect(cmd.cleanup).toBeDefined();
  });
});
