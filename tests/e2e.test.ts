import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand, runCommand } from "../src/index.js";
import { spyOnConsoleError, spyOnConsoleLog } from "./utils/console.js";

/**
 * Task 9.2: E2E tests
 * - Test basic command execution flow
 * - Test subcommand routing and lazy loading
 * - Test validation errors and help display
 * - Test metadata priority
 */
describe("E2E Tests", () => {
  describe("Basic command execution", () => {
    it("should execute a simple command", async () => {
      const output: string[] = [];

      const cmd = defineCommand({
        name: "greet",
        args: z.object({
          name: arg(z.string(), { description: "Name to greet" }),
        }),
        run: (args) => {
          output.push(`Hello, ${args.name}!`);
        },
      });

      await runCommand(cmd, ["--name", "World"]);

      expect(output).toEqual(["Hello, World!"]);
    });

    it("should handle positional and named args together", async () => {
      const result: Record<string, unknown> = {};

      const cmd = defineCommand({
        name: "copy",
        args: z.object({
          src: arg(z.string(), { positional: true, description: "Source file" }),
          dest: arg(z.string(), { positional: true, description: "Destination file" }),
          verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose output" }),
          force: arg(z.boolean().default(false), { alias: "f", description: "Force overwrite" }),
        }),
        run: (args) => {
          Object.assign(result, args);
        },
      });

      await runCommand(cmd, ["input.txt", "output.txt", "-v", "--force"]);

      expect(result).toEqual({
        src: "input.txt",
        dest: "output.txt",
        verbose: true,
        force: true,
      });
    });

    it("should apply default values from schema", async () => {
      const result: Record<string, unknown> = {};

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          port: z.number().default(3000),
          host: z.string().default("localhost"),
        }),
        run: (args) => {
          Object.assign(result, args);
        },
      });

      await runCommand(cmd, []);

      expect(result).toEqual({
        port: 3000,
        host: "localhost",
      });
    });
  });

  describe("Subcommand routing", () => {
    it("should route to correct subcommand", async () => {
      const executed: string[] = [];

      const buildCmd = defineCommand({
        name: "build",
        args: z.object({
          watch: arg(z.boolean().default(false), { alias: "w" }),
        }),
        run: (args) => {
          executed.push(`build:watch=${args.watch}`);
        },
      });

      const testCmd = defineCommand({
        name: "test",
        args: z.object({
          coverage: arg(z.boolean().default(false), { alias: "c" }),
        }),
        run: (args) => {
          executed.push(`test:coverage=${args.coverage}`);
        },
      });

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: buildCmd,
          test: testCmd,
        },
      });

      await runCommand(cmd, ["build", "--watch"]);
      await runCommand(cmd, ["test", "-c"]);

      expect(executed).toEqual(["build:watch=true", "test:coverage=true"]);
    });

    it("should support lazy-loaded subcommands", async () => {
      let lazyLoaded = false;

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          lazy: async () => {
            lazyLoaded = true;
            return defineCommand({
              name: "lazy",
              run: () => "lazy executed",
            });
          },
        },
      });

      expect(lazyLoaded).toBe(false);

      const result = await runCommand(cmd, ["lazy"]);

      expect(lazyLoaded).toBe(true);
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Validation", () => {
    it("should validate with zod refinements", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          port: z.coerce
            .number()
            .refine((n) => n >= 1024 && n <= 65535, "Port must be between 1024 and 65535"),
        }),
      });

      const result = await runCommand(cmd, ["--port", "80"]);

      expect(result.exitCode).toBe(1);
      consoleSpy.mockRestore();
    });

    it("should validate with zod transforms", async () => {
      let transformed: number | undefined;

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          port: z.coerce.number().transform((n) => n * 2),
        }),
        run: (args) => {
          transformed = args.port;
        },
      });

      await runCommand(cmd, ["--port", "4000"]);

      expect(transformed).toBe(8000);
    });
  });

  describe("Help generation", () => {
    it("should generate help with all metadata", async () => {
      const console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "my-cli",
        description: "A sample CLI application",
        args: z.object({
          config: arg(z.string(), {
            alias: "c",
            description: "Path to config file",
            placeholder: "FILE",
          }),
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose logging",
          }),
          port: arg(z.number().default(3000), {
            alias: "p",
            description: "Port to listen on",
          }),
        }),
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
          }),
          test: defineCommand({
            name: "test",
            description: "Run tests",
          }),
        },
      });

      await runCommand(cmd, ["--help"]);

      const output = console.getLogs()[0] ?? "";

      // Check header
      expect(output).toContain("my-cli");
      expect(output).toContain("A sample CLI application");

      // Check options
      expect(output).toContain("-c");
      expect(output).toContain("--config");
      expect(output).toContain("Path to config file");
      expect(output).toContain("-v");
      expect(output).toContain("--verbose");
      expect(output).toContain("default: false");
      expect(output).toContain("-p");
      expect(output).toContain("--port");
      expect(output).toContain("default: 3000");

      // Check subcommands
      expect(output).toContain("Commands:");
      expect(output).toContain("build");
      expect(output).toContain("test");

      console.mockRestore();
    });
  });

  describe("Lifecycle hooks", () => {
    it("should execute setup → run → cleanup in order", async () => {
      const order: string[] = [];

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          name: z.string().default("test"),
        }),
        setup: ({ args }) => {
          order.push(`setup:${args.name}`);
        },
        run: (args) => {
          order.push(`run:${args.name}`);
          return "done";
        },
        cleanup: ({ args, error }) => {
          order.push(`cleanup:${args.name}:error=${error !== undefined}`);
        },
      });

      await runCommand(cmd, []);

      expect(order).toEqual(["setup:test", "run:test", "cleanup:test:error=false"]);
    });

    it("should run cleanup even on error", async () => {
      const cleanupRan = { value: false };

      const cmd = defineCommand({
        name: "test-cmd",
        run: () => {
          throw new Error("Test error");
        },
        cleanup: ({ error }) => {
          cleanupRan.value = true;
          expect(error?.message).toBe("Test error");
        },
      });

      const result = await runCommand(cmd, []);

      expect(cleanupRan.value).toBe(true);
      expect(result.exitCode).toBe(1);
    });
  });

  describe("Return values", () => {
    it("should return result from run function", async () => {
      const cmd = defineCommand({
        name: "test-cmd",
        run: () => ({
          status: "success",
          count: 42,
        }),
      });

      const result = await runCommand(cmd, []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toEqual({
          status: "success",
          count: 42,
        });
      }
    });

    it("should return async result", async () => {
      const cmd = defineCommand({
        name: "test-cmd",
        run: async () => {
          await new Promise((r) => setTimeout(r, 10));
          return "async-result";
        },
      });

      const result = await runCommand(cmd, []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toBe("async-result");
      }
    });
  });

  describe("Multiple positional arguments", () => {
    it("should pass multiple positionals to run function", async () => {
      const result: Record<string, unknown> = {};

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          command: arg(z.string(), { positional: true }),
          target: arg(z.string(), { positional: true }),
        }),
        run: (args) => {
          Object.assign(result, args);
        },
      });

      await runCommand(cmd, ["build", "src/index.ts"]);

      expect(result).toEqual({
        command: "build",
        target: "src/index.ts",
      });
    });

    it("should validate required positionals", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          src: arg(z.string(), { positional: true }),
          dest: arg(z.string(), { positional: true }),
        }),
      });

      // Missing second required positional
      const result = await runCommand(cmd, ["input.txt"]);

      expect(result.exitCode).toBe(1);
      consoleSpy.mockRestore();
    });

    it("should handle optional positional with default", async () => {
      const result: Record<string, unknown> = {};

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string().default("out.txt"), { positional: true }),
        }),
        run: (args) => {
          Object.assign(result, args);
        },
      });

      await runCommand(cmd, ["input.txt"]);

      expect(result).toEqual({
        input: "input.txt",
        output: "out.txt",
      });
    });

    it("should transform positional arguments with zod", async () => {
      const result: { id?: number; name?: string } = {};

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          id: arg(z.coerce.number(), { positional: true }),
          name: arg(
            z.string().transform((s) => s.toUpperCase()),
            { positional: true },
          ),
        }),
        run: (args) => {
          result.id = args.id;
          result.name = args.name;
        },
      });

      await runCommand(cmd, ["42", "hello"]);

      expect(result).toEqual({
        id: 42,
        name: "HELLO",
      });
    });

    it("should work with cp-like command pattern", async () => {
      const operations: string[] = [];

      const cmd = defineCommand({
        name: "cp",
        args: z.object({
          source: arg(z.string(), { positional: true, description: "Source file" }),
          destination: arg(z.string(), { positional: true, description: "Destination" }),
          recursive: arg(z.boolean().default(false), { alias: "r" }),
          force: arg(z.boolean().default(false), { alias: "f" }),
        }),
        run: (args) => {
          const flags = [args.recursive ? "-r" : "", args.force ? "-f" : ""]
            .filter(Boolean)
            .join(" ");
          operations.push(`cp ${flags} ${args.source} ${args.destination}`.trim());
        },
      });

      await runCommand(cmd, ["-r", "dir1", "dir2"]);
      await runCommand(cmd, ["file.txt", "backup.txt", "-f"]);

      expect(operations).toEqual(["cp -r dir1 dir2", "cp -f file.txt backup.txt"]);
    });

    it("should handle array positional as last argument (cat-like)", async () => {
      let result: { files?: string[] } = {};

      const cmd = defineCommand({
        name: "cat",
        args: z.object({
          files: arg(z.array(z.string()), {
            positional: true,
            description: "Files to concatenate",
          }),
        }),
        run: (args) => {
          result.files = args.files;
        },
      });

      await runCommand(cmd, ["file1.txt", "file2.txt", "file3.txt"]);

      expect(result.files).toEqual(["file1.txt", "file2.txt", "file3.txt"]);
    });

    it("should handle command + array positional (gcc-like)", async () => {
      let result: { output?: string; sources?: string[] } = {};

      const cmd = defineCommand({
        name: "compile",
        args: z.object({
          output: arg(z.string(), { alias: "o", description: "Output file" }),
          sources: arg(z.array(z.string()), { positional: true, description: "Source files" }),
        }),
        run: (args) => {
          result = { output: args.output, sources: args.sources };
        },
      });

      await runCommand(cmd, ["-o", "app", "main.c", "util.c", "lib.c"]);

      expect(result).toEqual({
        output: "app",
        sources: ["main.c", "util.c", "lib.c"],
      });
    });

    it("should error when positional follows array positional", async () => {
      const consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          files: arg(z.array(z.string()), { positional: true }),
          output: arg(z.string(), { positional: true }),
        }),
      });

      const result = await runCommand(cmd, ["a.txt", "b.txt"]);

      expect(result.exitCode).toBe(1);
      // Verify the error message was logged
      expect(consoleSpy).toHaveBeenCalled();
      const errorMessage = consoleSpy.getLogs()[0] ?? "";
      expect(errorMessage).toContain("output");
      expect(errorMessage).toContain("files");

      consoleSpy.mockRestore();
    });

    it("should error when required positional follows optional positional", async () => {
      const consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          optional: arg(z.string().optional(), { positional: true }),
          required: arg(z.string(), { positional: true }),
        }),
      });

      const result = await runCommand(cmd, ["a", "b"]);

      expect(result.exitCode).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();
      const errorMessage = consoleSpy.getLogs()[0] ?? "";
      expect(errorMessage).toContain("required");
      expect(errorMessage).toContain("optional");

      consoleSpy.mockRestore();
    });

    it("should work with required then optional positionals", async () => {
      let captured: { input?: string; output?: string | undefined } = {};

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string().optional(), { positional: true }),
        }),
        run: (args) => {
          captured = { input: args.input, output: args.output };
        },
      });

      // With both positionals
      await runCommand(cmd, ["in.txt", "out.txt"]);
      expect(captured).toEqual({ input: "in.txt", output: "out.txt" });

      // With only required
      captured = {};
      await runCommand(cmd, ["in.txt"]);
      expect(captured).toEqual({ input: "in.txt", output: undefined });
    });

    it("should work with default value positional at the end", async () => {
      let captured: { input?: string; output?: string } = {};

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string().default("default.txt"), { positional: true }),
        }),
        run: (args) => {
          captured = { input: args.input, output: args.output };
        },
      });

      // With only required - default is applied via Zod validation
      await runCommand(cmd, ["in.txt"]);
      expect(captured).toEqual({ input: "in.txt", output: "default.txt" });

      // With both
      captured = {};
      await runCommand(cmd, ["in.txt", "custom.txt"]);
      expect(captured).toEqual({ input: "in.txt", output: "custom.txt" });
    });

    it("should error when array positional is used with optional positional", async () => {
      const consoleSpy = spyOnConsoleError();

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          mode: arg(z.string().optional(), { positional: true }),
          files: arg(z.array(z.string()), { positional: true }),
        }),
      });

      const result = await runCommand(cmd, ["a.txt"]);

      expect(result.exitCode).toBe(1);
      expect(consoleSpy).toHaveBeenCalled();
      const errorMessage = consoleSpy.getLogs()[0] ?? "";
      expect(errorMessage).toContain("files");
      expect(errorMessage).toContain("mode");
      expect(errorMessage).toContain("ambiguous");

      consoleSpy.mockRestore();
    });
  });

  describe("Array arguments", () => {
    it("should handle multiple values for same flag", async () => {
      const result: { files?: string[] } = {};

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          files: arg(z.array(z.string()), { alias: "f", description: "Input files" }),
        }),
        run: (args) => {
          result.files = args.files;
        },
      });

      await runCommand(cmd, ["--files", "a.txt", "--files", "b.txt", "-f", "c.txt"]);

      expect(result.files).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("should validate array elements with zod", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          ports: arg(z.array(z.coerce.number().min(1).max(65535)), { description: "Ports" }),
        }),
      });

      const result = await runCommand(cmd, ["--ports", "8080", "--ports", "99999"]);

      expect(result.exitCode).toBe(1);
      consoleSpy.mockRestore();
    });

    it("should transform array elements", async () => {
      let result: number[] | undefined;

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          numbers: arg(z.array(z.coerce.number()), { alias: "n" }),
        }),
        run: (args) => {
          result = args.numbers;
        },
      });

      await runCommand(cmd, ["-n", "1", "-n", "2", "-n", "3"]);

      expect(result).toEqual([1, 2, 3]);
    });

    it("should use default empty array", async () => {
      let result: string[] | undefined;

      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          tags: arg(z.array(z.string()).default([]), { alias: "t" }),
        }),
        run: (args) => {
          result = args.tags;
        },
      });

      await runCommand(cmd, []);

      expect(result).toEqual([]);
    });
  });

  describe("Single file completion", () => {
    it("should work as a complete CLI in one definition", async () => {
      // This test verifies Requirement 9.1: single file completion
      const console = spyOnConsoleLog();
      const output = console.getLogs();

      const cli = defineCommand({
        name: "my-tool",
        description: "A complete CLI tool",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string(), { alias: "o" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        subCommands: {
          init: defineCommand({
            name: "init",
            description: "Initialize project",
            run: () => console.log("Initialized!"),
          }),
        },
        run: (args) => {
          console.log(`Processing ${args.input} → ${args.output}`);
          return { processed: true };
        },
      });

      // Test main command
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt"]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toEqual({ processed: true });
      }
      expect(output).toContain("Processing file.txt → out.txt");

      console.mockRestore();
    });
  });
});
