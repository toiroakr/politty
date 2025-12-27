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
    it("should warn about unknown flags", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: z.boolean().default(false),
        }),
      });

      await runCommand(cmd, ["--unknown-flag"]);

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
