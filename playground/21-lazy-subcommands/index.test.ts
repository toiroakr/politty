import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { cli, statusCommand } from "./index.js";

describe("21-lazy-subcommands", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("status subcommand (eagerly loaded)", () => {
    it("runs status command", async () => {
      const result = await runCommand(cli, ["status"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Status: OK");
    });

    it("runs status command with verbose flag", async () => {
      const result = await runCommand(cli, ["status", "-v"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Status: OK");
      expect(console).toHaveBeenCalledWith("  Uptime: 42 days");
      expect(console).toHaveBeenCalledWith("  Memory: 128MB");
    });

    it("can run statusCommand directly", async () => {
      const result = await runCommand(statusCommand, ["-v"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Status: OK");
    });
  });

  describe("heavy subcommand (lazily loaded)", () => {
    it("runs heavy command with default options", async () => {
      const result = await runCommand(cli, ["heavy"]);

      expect(result.exitCode).toBe(0);
      // Module load log
      expect(console).toHaveBeenCalledWith("[heavy-command] Module loaded");
      // Command execution log
      expect(console).toHaveBeenCalledWith("Running heavy computation with 1000 iterations...");
    });

    it("runs heavy command with custom iterations", async () => {
      const result = await runCommand(cli, ["heavy", "-n", "5000"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Running heavy computation with 5000 iterations...");
    });

    it("runs heavy command with verbose flag", async () => {
      const result = await runCommand(cli, ["heavy", "-v"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  (verbose mode enabled)");
    });
  });

  describe("analytics subcommand (lazily loaded)", () => {
    it("runs analytics command with default options", async () => {
      const result = await runCommand(cli, ["analytics"]);

      expect(result.exitCode).toBe(0);
      // Module load log
      expect(console).toHaveBeenCalledWith("[analytics-command] Module loaded");
      // Command execution log
      expect(console).toHaveBeenCalledWith("lines: 12500");
    });

    it("runs analytics with custom metric", async () => {
      const result = await runCommand(cli, ["analytics", "-m", "complexity"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("complexity: 4.2");
    });

    it("runs analytics with json format", async () => {
      const result = await runCommand(cli, ["analytics", "-m", "files", "-f", "json"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain('"metric": "files"');
      expect(output).toContain('"value": 87');
    });
  });

  describe("help", () => {
    it("shows help for main CLI with all subcommands listed", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("my-app");
      // All subcommands should be listed
      expect(output).toContain("status");
      expect(output).toContain("heavy");
      expect(output).toContain("analytics");
    });

    it("shows help for lazily loaded subcommand", async () => {
      const result = await runCommand(cli, ["heavy", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("heavy");
      expect(output).toContain("--iterations");
      expect(output).toContain("--verbose");
    });
  });

  it("documentation", async () => {
    await assertDocMatch({
      command: cli,
      files: { "playground/21-lazy-subcommands/README.md": [""] },
    });
  });
});
