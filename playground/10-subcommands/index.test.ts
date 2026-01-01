import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { oxfmtFormatter } from "../../tests/utils/formatter.js";
import { buildCommand, cli, initCommand } from "./index.js";

describe("10-subcommands", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("init subcommand", () => {
    it("initializes with default template", async () => {
      const result = await runCommand(cli, ["init"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Initializing project:");
      expect(console).toHaveBeenCalledWith("  Template: default");
    });

    it("initializes with custom template using -t", async () => {
      const result = await runCommand(cli, ["init", "-t", "react"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Template: react");
    });

    it("enables force mode with -f", async () => {
      const result = await runCommand(cli, ["init", "-f"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  (force mode)");
    });

    it("can run initCommand directly", async () => {
      const result = await runCommand(initCommand, ["-t", "vue"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Template: vue");
    });
  });

  describe("build subcommand", () => {
    it("builds with default output", async () => {
      const result = await runCommand(cli, ["build"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Building project:");
      expect(console).toHaveBeenCalledWith("  Output: dist");
      expect(console).toHaveBeenCalledWith("  Minify: false");
    });

    it("builds with custom output and minify", async () => {
      const result = await runCommand(cli, ["build", "-o", "out", "-m"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Output: out");
      expect(console).toHaveBeenCalledWith("  Minify: true");
    });

    it("enables watch mode with -w", async () => {
      const result = await runCommand(cli, ["build", "-w"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  (watch mode)");
    });

    it("can run buildCommand directly", async () => {
      const result = await runCommand(buildCommand, ["-o", "build", "-m"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Output: build");
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("my-cli");
      expect(output).toContain("init");
      expect(output).toContain("build");
    });

    it("shows help for subcommand", async () => {
      const result = await runCommand(cli, ["build", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("build");
      expect(output).toContain("--output");
    });
  });

  it("documentation", async () => {
    await assertDocMatch({
      command: cli,
      files: { "playground/10-subcommands/README.md": [""] },
      formatter: oxfmtFormatter,
    });
  });
});
