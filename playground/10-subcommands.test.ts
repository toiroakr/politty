import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { cli, initCommand, buildCommand } from "./10-subcommands.js";

describe("10-subcommands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("init subcommand", () => {
    it("initializes with default template", async () => {
      const result = await runCommand(cli, ["init"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Initializing project:");
      expect(consoleSpy).toHaveBeenCalledWith("  Template: default");
    });

    it("initializes with custom template using -t", async () => {
      const result = await runCommand(cli, ["init", "-t", "react"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Template: react");
    });

    it("enables force mode with -f", async () => {
      const result = await runCommand(cli, ["init", "-f"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  (force mode)");
    });

    it("can run initCommand directly", async () => {
      const result = await runCommand(initCommand, ["-t", "vue"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Template: vue");
    });
  });

  describe("build subcommand", () => {
    it("builds with default output", async () => {
      const result = await runCommand(cli, ["build"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Building project:");
      expect(consoleSpy).toHaveBeenCalledWith("  Output: dist");
      expect(consoleSpy).toHaveBeenCalledWith("  Minify: false");
    });

    it("builds with custom output and minify", async () => {
      const result = await runCommand(cli, ["build", "-o", "out", "-m"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Output: out");
      expect(consoleSpy).toHaveBeenCalledWith("  Minify: true");
    });

    it("enables watch mode with -w", async () => {
      const result = await runCommand(cli, ["build", "-w"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  (watch mode)");
    });

    it("can run buildCommand directly", async () => {
      const result = await runCommand(buildCommand, ["-o", "build", "-m"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Output: build");
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("my-cli");
      expect(output).toContain("init");
      expect(output).toContain("build");
    });

    it("shows help for subcommand", async () => {
      const result = await runCommand(cli, ["build", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("build");
      expect(output).toContain("--output");
    });
  });
});
