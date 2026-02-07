import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { arg } from "./arg-registry.js";
import { defineCommand } from "./command.js";
import { runCommand } from "./runner.js";

/**
 * Task 8.1: runCommand function tests
 * - Integrate parse → validation → execution flow
 * - Configure default help display behavior
 * - Debug mode options
 */
describe("runCommand", () => {
  describe("Full execution flow", () => {
    it("should parse, validate, and run command", async () => {
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
        run: runFn,
      });

      await runCommand(cmd, ["--name", "John"]);

      expect(runFn).toHaveBeenCalledWith({ name: "John" });
    });

    it("should handle positional arguments", async () => {
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          file: arg(z.string(), { positional: true }),
        }),
        run: runFn,
      });

      await runCommand(cmd, ["input.txt"]);

      expect(runFn).toHaveBeenCalledWith({ file: "input.txt" });
    });

    it("should apply default values", async () => {
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      await runCommand(cmd, []);

      expect(runFn).toHaveBeenCalledWith({ verbose: false });
    });

    it("should return result from run function", async () => {
      const cmd = defineCommand({
        name: "test",
        run: () => ({ success: true }),
      });

      const result = await runCommand(cmd, []);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toEqual({ success: true });
      }
    });
  });

  describe("Help handling", () => {
    it("should show help on --help flag", async () => {
      const console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "my-cli",
        description: "Test CLI",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose mode",
          }),
        }),
      });

      const result = await runCommand(cmd, ["--help"]);

      expect(console).toHaveBeenCalled();
      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("my-cli");
      expect(output).toContain("Test CLI");
      expect(result.exitCode).toBe(0);

      console.mockRestore();
    });

    it("should show help on -h flag", async () => {
      const console = spyOnConsoleLog();

      const cmd = defineCommand({ name: "cli" });

      await runCommand(cmd, ["-h"]);

      expect(console).toHaveBeenCalled();
      console.mockRestore();
    });

    it("should show --help-all option when subcommands exist", async () => {
      const console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      await runCommand(cmd, ["--help"]);

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("--help-all");
      console.mockRestore();
    });

    it("should show subcommand options on --help-all", async () => {
      const console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
            }),
          }),
        },
      });

      await runCommand(cmd, ["--help-all"]);

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("build");
      expect(output).toContain("--output");
      expect(output).toContain("Output directory");
      console.mockRestore();
    });

    it("should show subcommand help on subcmd --help", async () => {
      const console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
            args: z.object({
              output: arg(z.string().default("dist"), { alias: "o" }),
            }),
          }),
        },
      });

      await runCommand(cmd, ["build", "--help"]);

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("build");
      expect(output).toContain("Build the project");
      expect(output).toContain("--output");
      console.mockRestore();
    });
  });

  describe("Validation errors", () => {
    it("should show error for invalid arguments", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          port: z.coerce.number(),
        }),
      });

      const result = await runCommand(cmd, ["--port", "not-a-number"]);

      expect(result.exitCode).toBe(1);

      consoleSpy.mockRestore();
    });

    it("should show error for missing required arguments", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
      });

      const result = await runCommand(cmd, []);

      expect(result.exitCode).toBe(1);

      consoleSpy.mockRestore();
    });
  });

  describe("Subcommand routing", () => {
    it("should route to subcommand", async () => {
      const buildFn = vi.fn();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              watch: arg(z.boolean().default(false), { alias: "w" }),
            }),
            run: buildFn,
          }),
        },
      });

      await runCommand(cmd, ["build", "--watch"]);

      expect(buildFn).toHaveBeenCalledWith({ watch: true });
    });

    it("should show help when subcommand not specified", async () => {
      const console = spyOnConsoleLog();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      await runCommand(cmd, []);

      expect(console).toHaveBeenCalled();
      console.mockRestore();
    });
  });

  describe("Unknown flags", () => {
    it("should warn about unknown flags with default z.object (strip mode)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: z.boolean().default(false),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Strip mode: should warn but continue execution
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(output).toContain("Warning");
      expect(output).toContain("unknown-flag");
      expect(runFn).toHaveBeenCalled(); // Command should still run
      expect(result.success).toBe(true);
      consoleSpy.mockRestore();
    });

    it("should error on unknown flags with z.strictObject (strict mode)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.strictObject({
          verbose: z.boolean().default(false),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Strict mode: should error and not continue execution
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(output).toContain("Unknown option");
      expect(output).not.toContain("Warning");
      expect(runFn).not.toHaveBeenCalled(); // Command should not run
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      consoleSpy.mockRestore();
    });

    it("should error on unknown flags with z.object().strict()", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z
          .object({
            verbose: z.boolean().default(false),
          })
          .strict(),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Strict mode: should error and not continue execution
      expect(consoleSpy).toHaveBeenCalled();
      expect(runFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      consoleSpy.mockRestore();
    });

    it("should silently ignore unknown flags with z.looseObject (passthrough mode)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.looseObject({
          verbose: z.boolean().default(false),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Passthrough mode: should silently ignore and continue execution
      expect(consoleSpy).not.toHaveBeenCalled(); // No warning
      expect(runFn).toHaveBeenCalled(); // Command should run
      expect(result.success).toBe(true);
      consoleSpy.mockRestore();
    });

    it("should silently ignore unknown flags with z.object().passthrough()", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z
          .object({
            verbose: z.boolean().default(false),
          })
          .passthrough(),
        run: runFn,
      });

      const result = await runCommand(cmd, ["--unknown-flag"]);

      // Passthrough mode: should silently ignore and continue execution
      expect(consoleSpy).not.toHaveBeenCalled(); // No warning
      expect(runFn).toHaveBeenCalled(); // Command should run
      expect(result.success).toBe(true);
      consoleSpy.mockRestore();
    });

    // Short option (alias) tests
    it("should warn about unknown short flags with default z.object (strip mode)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["-x"]); // Unknown short flag

      // Strip mode: should warn but continue execution
      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(output).toContain("Warning");
      expect(runFn).toHaveBeenCalled();
      expect(result.success).toBe(true);
      consoleSpy.mockRestore();
    });

    it("should error on unknown short flags with z.strictObject (strict mode)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.strictObject({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["-x"]); // Unknown short flag

      // Strict mode: should error and not continue execution
      expect(consoleSpy).toHaveBeenCalled();
      expect(runFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
      consoleSpy.mockRestore();
    });

    it("should silently ignore unknown short flags with z.looseObject (passthrough mode)", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.looseObject({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      const result = await runCommand(cmd, ["-x"]); // Unknown short flag

      // Passthrough mode: should silently ignore and continue execution
      expect(consoleSpy).not.toHaveBeenCalled();
      expect(runFn).toHaveBeenCalled();
      expect(result.success).toBe(true);
      consoleSpy.mockRestore();
    });
  });

  describe("Global arguments", () => {
    it("should pass global args to command run function", async () => {
      const runFn = vi.fn();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: z.string(),
        }),
        run: runFn,
      });

      await runCommand(cmd, ["--verbose", "--name", "John"], { globalArgs });

      expect(runFn).toHaveBeenCalledWith({
        name: "John",
        verbose: true,
      });
    });

    it("should pass global args to subcommand run function", async () => {
      const buildFn = vi.fn();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
        config: arg(z.string().optional(), { alias: "c" }),
      });

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string().default("dist"), { alias: "o" }),
            }),
            run: buildFn,
          }),
        },
      });

      await runCommand(cmd, ["--verbose", "build", "--output", "build"], {
        globalArgs,
      });

      expect(buildFn).toHaveBeenCalledWith({
        verbose: true,
        config: undefined,
        output: "build",
      });
    });

    it("should allow command args to override global args with same name", async () => {
      const runFn = vi.fn();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          // Command-level verbose overrides global verbose
          verbose: arg(z.boolean().default(true)),
        }),
        run: runFn,
      });

      // Without --verbose flag, command default should be used
      await runCommand(cmd, [], { globalArgs });

      expect(runFn).toHaveBeenCalledWith({
        verbose: true, // Command default, not global default
      });
    });

    it("should work with command that has no args", async () => {
      const runFn = vi.fn();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      const cmd = defineCommand({
        name: "test",
        run: runFn,
      });

      await runCommand(cmd, ["--verbose"], { globalArgs });

      expect(runFn).toHaveBeenCalledWith({
        verbose: true,
      });
    });

    it("should show Global Options in help output", async () => {
      const console = spyOnConsoleLog();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
        config: arg(z.string().optional(), {
          alias: "c",
          description: "Path to config file",
        }),
      });

      const cmd = defineCommand({
        name: "my-cli",
        description: "Test CLI",
      });

      await runCommand(cmd, ["--help"], { globalArgs });

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("Global Options:");
      expect(output).toContain("--verbose");
      expect(output).toContain("-v");
      expect(output).toContain("Enable verbose output");
      expect(output).toContain("--config");
      expect(output).toContain("-c");
      expect(output).toContain("Path to config file");
      console.mockRestore();
    });

    it("should show Global Options in subcommand help output", async () => {
      const console = spyOnConsoleLog();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
            args: z.object({
              output: arg(z.string().default("dist"), { alias: "o" }),
            }),
          }),
        },
      });

      await runCommand(cmd, ["build", "--help"], { globalArgs });

      const output = console.getLogs()[0] ?? "";
      expect(output).toContain("build");
      expect(output).toContain("Build the project");
      expect(output).toContain("--output");
      expect(output).toContain("Global Options:");
      expect(output).toContain("--verbose");
      console.mockRestore();
    });

    it("should apply default values for global args", async () => {
      const runFn = vi.fn();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false)),
        level: arg(z.coerce.number().default(1)),
      });

      const cmd = defineCommand({
        name: "test",
        run: runFn,
      });

      await runCommand(cmd, [], { globalArgs });

      expect(runFn).toHaveBeenCalledWith({
        verbose: false,
        level: 1,
      });
    });

    it("should propagate global args through nested subcommands", async () => {
      const nestedFn = vi.fn();

      const globalArgs = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          config: defineCommand({
            name: "config",
            subCommands: {
              set: defineCommand({
                name: "set",
                args: z.object({
                  key: arg(z.string(), { positional: true }),
                  value: arg(z.string(), { positional: true }),
                }),
                run: nestedFn,
              }),
            },
          }),
        },
      });

      await runCommand(cmd, ["--verbose", "config", "set", "foo", "bar"], {
        globalArgs,
      });

      expect(nestedFn).toHaveBeenCalledWith({
        verbose: true,
        key: "foo",
        value: "bar",
      });
    });
  });
});
