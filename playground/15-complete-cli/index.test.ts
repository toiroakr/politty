import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { cli, initCommand } from "./index.js";

describe("15-complete-cli", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("main command", () => {
    it("processes file with required options", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Processing:");
      expect(console).toHaveBeenCalledWith("  Input: file.txt");
      expect(console).toHaveBeenCalledWith("  Output: out.txt");
      expect(console).toHaveBeenCalledWith("  Format: json");
    });

    it("returns result from run function", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt"]);

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toEqual({ processed: true, format: "json" });
      }
    });

    it("enables verbose mode with -v", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt", "-v"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("[setup] Initializing...");
      expect(console).toHaveBeenCalledWith("[run] Processing...");
      expect(console).toHaveBeenCalledWith("[cleanup] Cleaning up...");
    });

    it("uses custom format with -f", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt", "-f", "yaml"]);

      expect(result.success).toBe(true);
      expect(console).toHaveBeenCalledWith("  Format: yaml");
      if (result.success) {
        expect(result.result).toEqual({ processed: true, format: "yaml" });
      }
    });
  });

  describe("init subcommand", () => {
    it("initializes with default template", async () => {
      const result = await runCommand(cli, ["init"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith(
        'Initializing project "my-project" with template "default"...',
      );
      expect(console).toHaveBeenCalledWith("Done!");
    });

    it("initializes with custom template using -t", async () => {
      const result = await runCommand(cli, ["init", "-t", "react"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith(
        'Initializing project "my-project" with template "react"...',
      );
    });

    it("initializes with custom name using -n", async () => {
      const result = await runCommand(cli, ["init", "-n", "my-app"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith(
        'Initializing project "my-app" with template "default"...',
      );
    });

    it("can run initCommand directly", async () => {
      const result = await runCommand(initCommand, ["-t", "vue", "-n", "vue-app"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith('Initializing project "vue-app" with template "vue"...');
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("my-tool");
      expect(output).toContain("init");
    });
  });

  it("documentation", async () => {
    await assertDocMatch({
      command: cli,
      files: { "playground/15-complete-cli/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
