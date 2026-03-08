import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { assertDocMatch } from "../../src/docs/index.js";
import { arg, defineCommand, generateCompletion, runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { buildCommand, cli, globalArgsSchema } from "./index.js";

describe("25-global-options", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("global flags before subcommand", () => {
    it("passes verbose to build", async () => {
      const result = await runCommand(cli, ["--verbose", "build", "--output", "out"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("[verbose] Config: (default)");
      expect(console).toHaveBeenCalledWith("Building to out");
    });

    it("passes verbose with alias -v to deploy", async () => {
      const result = await runCommand(cli, ["-v", "deploy", "--env", "staging"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("[verbose] Config: (default)");
      expect(console).toHaveBeenCalledWith("Deploying to staging");
    });

    it("passes config to build", async () => {
      const result = await runCommand(cli, ["--config", "custom.json", "--verbose", "build"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("[verbose] Config: custom.json");
      expect(console).toHaveBeenCalledWith("Building to dist");
    });
  });

  describe("global flags after subcommand", () => {
    it("passes verbose after build", async () => {
      const result = await runCommand(cli, ["build", "--verbose", "--output", "out"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("[verbose] Config: (default)");
      expect(console).toHaveBeenCalledWith("Building to out");
    });

    it("passes verbose after deploy", async () => {
      const result = await runCommand(cli, ["deploy", "--verbose", "--env", "staging"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("[verbose] Config: (default)");
      expect(console).toHaveBeenCalledWith("Deploying to staging");
    });
  });

  describe("without global args", () => {
    it("build without verbose", async () => {
      const result = await runCommand(cli, ["build"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).not.toHaveBeenCalledWith(expect.stringContaining("[verbose]"));
      expect(console).toHaveBeenCalledWith("Building to dist");
    });
  });

  describe("help output", () => {
    it("shows Global Options section", async () => {
      const result = await runCommand(cli, ["--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("Global Options:");
      expect(output).toContain("--verbose");
      expect(output).toContain("--config");
      expect(output).toContain("[global options]");
    });

    it("shows Global Options in subcommand help", async () => {
      const result = await runCommand(cli, ["build", "--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("Global Options:");
      expect(output).toContain("--verbose");
    });
  });

  describe("backward compatibility", () => {
    it("works without globalArgs option", async () => {
      const result = await runCommand(cli, ["build", "--output", "out"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Building to out");
    });

    it("subcommand directly without globalArgs", async () => {
      const result = await runCommand(buildCommand, ["--output", "custom"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Building to custom");
    });
  });

  describe("command with no local args schema", () => {
    it("receives global args even without own args schema", async () => {
      const noArgsCmd = defineCommand({
        name: "no-args",
        description: "Command without args",
        run: (args: Record<string, unknown>) => {
          console.log(`verbose=${args.verbose}`);
        },
      });

      const root = defineCommand({
        name: "test-cli",
        subCommands: { "no-args": noArgsCmd },
      });

      const result = await runCommand(root, ["no-args", "--verbose"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("verbose=true");
    });
  });

  describe("help with valued global option", () => {
    it("does not treat option value as unknown subcommand", async () => {
      const result = await runCommand(cli, ["--config", "custom.json", "--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).not.toContain("Unknown command");
      expect(output).toContain("Global Options:");
    });
  });

  describe("global/local flag collision", () => {
    it("local flag takes precedence over global when both define same name", async () => {
      // Both global and local define --output
      const globalSchema = z.object({
        output: arg(z.string().default("global-default"), {
          description: "Global output",
        }),
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Verbose",
        }),
      });

      const cmd = defineCommand({
        name: "cmd",
        description: "Test command",
        args: z.object({
          output: arg(z.string().default("local-default"), {
            alias: "o",
            description: "Local output",
          }),
        }),
        run: (args) => {
          console.log(`output=${args.output}`);
        },
      });

      const root = defineCommand({
        name: "test-cli",
        subCommands: { cmd },
      });

      const result = await runCommand(root, ["cmd", "--output", "mine"], {
        globalArgs: globalSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("output=mine");
    });
  });

  describe("global schema validation", () => {
    it("rejects positional arguments in global schema", async () => {
      const badGlobal = z.object({
        file: arg(z.string(), { positional: true, description: "A file" }),
      });

      await expect(runCommand(cli, ["build"], { globalArgs: badGlobal })).rejects.toThrow(
        /positional/i,
      );
    });

    it("rejects reserved alias -h in global schema", async () => {
      const badGlobal = z.object({
        // @ts-expect-error -- intentionally using reserved alias to test runtime validation
        help: arg(z.boolean().default(false), { alias: "h", description: "Help" }),
      });

      await expect(runCommand(cli, ["build"], { globalArgs: badGlobal })).rejects.toThrow(
        /reserved/i,
      );
    });

    it("rejects reserved alias -H in global schema", async () => {
      const badGlobal = z.object({
        // @ts-expect-error -- intentionally using reserved alias to test runtime validation
        helpAll: arg(z.boolean().default(false), { alias: "H", description: "Help all" }),
      });

      await expect(runCommand(cli, ["build"], { globalArgs: badGlobal })).rejects.toThrow(
        /reserved/i,
      );
    });
  });

  describe("completion with global options", () => {
    it("includes global options in subcommand completions", () => {
      const result = generateCompletion(cli, {
        shell: "bash",
        programName: "my-app",
        globalArgsSchema,
      });

      // Global options should appear in the completion script
      expect(result.script).toContain("verbose");
      expect(result.script).toContain("config");
      // Should also be in subcommand sections (propagated)
      expect(result.script).toMatch(/build.*verbose|verbose.*build/s);
    });
  });

  it("documentation", async () => {
    await assertDocMatch({
      command: cli,
      rootDoc: {
        path: "playground/25-global-options/REFERENCE.md",
      },
      files: {
        "playground/25-global-options/README.md": ["", "build", "deploy"],
      },
      globalArgs: globalArgsSchema,
      formatter: mdFormatter,
    });
  });
});
