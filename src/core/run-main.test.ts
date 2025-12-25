import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { runMain } from "./runner.js";
import { defineCommand } from "./command.js";
import { arg } from "./arg-registry.js";

/**
 * Task 8.1: runMain function tests
 * - Integrate parse → validation → execution flow
 * - Configure default help display behavior
 * - Debug mode and signal handling options
 */
describe("runMain", () => {
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

      await runMain(cmd, { argv: ["--name", "John"] });

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

      await runMain(cmd, { argv: ["input.txt"] });

      expect(runFn).toHaveBeenCalledWith({ file: "input.txt" });
    });

    it("should apply default values", async () => {
      const runFn = vi.fn();

      const cmd = defineCommand({
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: runFn,
      });

      await runMain(cmd, { argv: [] });

      expect(runFn).toHaveBeenCalledWith({ verbose: false });
    });

    it("should return result from run function", async () => {
      const cmd = defineCommand({
        run: () => ({ success: true }),
      });

      const result = await runMain(cmd, { argv: [] });

      expect(result.result).toEqual({ success: true });
      expect(result.exitCode).toBe(0);
    });
  });

  describe("Help handling", () => {
    it("should show help on --help flag", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

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

      const result = await runMain(cmd, { argv: ["--help"] });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("my-cli");
      expect(output).toContain("Test CLI");
      expect(result.exitCode).toBe(0);

      consoleSpy.mockRestore();
    });

    it("should show help on -h flag", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const cmd = defineCommand({ name: "cli" });

      await runMain(cmd, { argv: ["-h"] });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should show --help-all option when subcommands exist", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      await runMain(cmd, { argv: ["--help"] });

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("--help-all");
      consoleSpy.mockRestore();
    });

    it("should show subcommand options on --help-all", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

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

      await runMain(cmd, { argv: ["--help-all"] });

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("build");
      expect(output).toContain("--output");
      expect(output).toContain("Output directory");
      consoleSpy.mockRestore();
    });

    it("should show subcommand help on subcmd --help", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

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

      await runMain(cmd, { argv: ["build", "--help"] });

      const output = consoleSpy.mock.calls[0]?.[0] as string;
      expect(output).toContain("build");
      expect(output).toContain("Build the project");
      expect(output).toContain("--output");
      consoleSpy.mockRestore();
    });
  });

  describe("Version handling", () => {
    it("should show version on --version flag", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "my-cli",
        version: "1.2.3",
      });

      const result = await runMain(cmd, { argv: ["--version"] });

      expect(consoleSpy).toHaveBeenCalledWith("1.2.3");
      expect(result.exitCode).toBe(0);

      consoleSpy.mockRestore();
    });
  });

  describe("Validation errors", () => {
    it("should show error for invalid arguments", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        args: z.object({
          port: z.coerce.number(),
        }),
      });

      const result = await runMain(cmd, { argv: ["--port", "not-a-number"] });

      expect(result.exitCode).toBe(1);

      consoleSpy.mockRestore();
    });

    it("should show error for missing required arguments", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        args: z.object({
          name: z.string(),
        }),
      });

      const result = await runMain(cmd, { argv: [] });

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

      await runMain(cmd, { argv: ["build", "--watch"] });

      expect(buildFn).toHaveBeenCalledWith({ watch: true });
    });

    it("should show help when subcommand not specified", async () => {
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      await runMain(cmd, { argv: [], showSubcommands: true });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe("Unknown flags", () => {
    it("should warn about unknown flags", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        args: z.object({
          verbose: z.boolean().default(false),
        }),
      });

      await runMain(cmd, { argv: ["--unknown-flag"] });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});
