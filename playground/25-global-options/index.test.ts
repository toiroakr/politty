import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
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
});
