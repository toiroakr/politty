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

    it("should merge global args from before subcommand", async () => {
      const buildFn = vi.fn();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string()),
            }),
            run: buildFn,
          }),
        },
      });

      const globalArgsSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      await runCommand(cmd, ["--verbose", "build", "--output", "dist"], {
        globalArgs: globalArgsSchema,
      });

      expect(buildFn).toHaveBeenCalledWith({ verbose: true, output: "dist" });
    });

    it("should merge global args from after subcommand", async () => {
      const buildFn = vi.fn();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string()),
            }),
            run: buildFn,
          }),
        },
      });

      const globalArgsSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      await runCommand(cmd, ["build", "--verbose", "--output", "dist"], {
        globalArgs: globalArgsSchema,
      });

      expect(buildFn).toHaveBeenCalledWith({ verbose: true, output: "dist" });
    });

    it("should prioritize command args over global args on key collision", async () => {
      const buildFn = vi.fn();

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              verbose: arg(z.boolean().default(false)),
            }),
            run: buildFn,
          }),
        },
      });

      const globalArgsSchema = z.object({
        verbose: arg(z.boolean().default(false)),
      });

      await runCommand(cmd, ["--verbose", "build", "--no-verbose"], {
        globalArgs: globalArgsSchema,
      });

      expect(buildFn).toHaveBeenCalledWith({ verbose: false });
    });

    it("should return validation error when global args are invalid", async () => {
      const buildFn = vi.fn();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            run: buildFn,
          }),
        },
      });

      const globalArgsSchema = z.object({
        retries: arg(z.coerce.number().int().min(0)),
      });

      const result = await runCommand(cmd, ["build", "--retries", "oops"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(1);
      expect(buildFn).not.toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it("should apply env fallback for global args", async () => {
      const buildFn = vi.fn();
      const previousConfig = process.env.MY_APP_CONFIG;
      process.env.MY_APP_CONFIG = "/tmp/config.toml";

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string()),
            }),
            run: buildFn,
          }),
        },
      });

      const globalArgsSchema = z.object({
        config: arg(z.string().optional(), { env: "MY_APP_CONFIG" }),
      });

      await runCommand(cmd, ["build", "--output", "dist"], { globalArgs: globalArgsSchema });

      expect(buildFn).toHaveBeenCalledWith({ config: "/tmp/config.toml", output: "dist" });

      if (previousConfig === undefined) {
        delete process.env.MY_APP_CONFIG;
      } else {
        process.env.MY_APP_CONFIG = previousConfig;
      }
    });

    it("should fail when global args schema has duplicate aliases", async () => {
      const runFn = vi.fn();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        run: runFn,
      });

      const globalArgsSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
        version: arg(z.boolean().default(false), { alias: "v" }),
      });

      const result = await runCommand(cmd, [], { globalArgs: globalArgsSchema });

      expect(result.exitCode).toBe(1);
      expect(runFn).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      const message = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(message).toContain("Duplicate alias");
      consoleSpy.mockRestore();
    });

    it("should warn and continue when unknown global flag appears before subcommand", async () => {
      const buildFn = vi.fn();
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            run: buildFn,
          }),
        },
      });

      const globalArgsSchema = z.object({
        verbose: arg(z.boolean().default(false), { alias: "v" }),
      });

      const result = await runCommand(cmd, ["--unknown-flag", "build"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(buildFn).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalled();
      const warning = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(warning).toContain("unknown-flag");
      expect(warning).toContain("Warning");
      consoleSpy.mockRestore();
    });

    it("should not treat global option values as unknown subcommands on help", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      const globalArgsSchema = z.object({
        config: arg(z.string().optional(), { alias: "c" }),
      });

      const result = await runCommand(cmd, ["--config", "app.toml", "--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      const errorOutput = consoleErrorSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(errorOutput).not.toContain("Unknown command");
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("should not treat values after unknown --no-* flags as unknown subcommands on help", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      const globalArgsSchema = z.object({
        config: arg(z.string().optional(), { alias: "c" }),
      });

      const result = await runCommand(cmd, ["--no-config", "app.toml", "--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      const errorOutput = consoleErrorSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(errorOutput).not.toContain("Unknown command");
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it("should respect overridden -h alias while checking unknown subcommands on help", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      const globalArgsSchema = z.object({
        host: arg(z.string().optional(), {
          alias: "h",
          overrideBuiltinAlias: true,
        }),
      });

      const result = await runCommand(cmd, ["-h", "localhost", "unknown", "--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(1);
      const errorOutput = consoleErrorSpy.mock.calls.map((c) => String(c[0] ?? "")).join("\n");
      expect(errorOutput).toContain("Unknown command");
      expect(errorOutput).toContain("unknown");
      expect(consoleLogSpy).toHaveBeenCalled();

      consoleLogSpy.mockRestore();
      consoleErrorSpy.mockRestore();
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

    it("should error on unknown global flags when global schema is strict", async () => {
      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const runFn = vi.fn();

      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: z.boolean().default(false),
        }),
        run: runFn,
      });

      const globalArgsSchema = z.strictObject({
        config: arg(z.string().optional(), { alias: "c" }),
      });

      const result = await runCommand(cmd, ["--unknown-global"], {
        globalArgs: globalArgsSchema,
      });

      expect(consoleSpy).toHaveBeenCalled();
      const output = consoleSpy.mock.calls[0]?.[0] ?? "";
      expect(output).toContain("Unknown option");
      expect(output).toContain("unknown-global");
      expect(runFn).not.toHaveBeenCalled();
      expect(result.success).toBe(false);
      expect(result.exitCode).toBe(1);
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
});
