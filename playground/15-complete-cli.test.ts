import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { cli, initCommand } from "./15-complete-cli.js";

describe("15-complete-cli", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("main command", () => {
    it("processes file with required options", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Processing:");
      expect(consoleSpy).toHaveBeenCalledWith("  Input: file.txt");
      expect(consoleSpy).toHaveBeenCalledWith("  Output: out.txt");
      expect(consoleSpy).toHaveBeenCalledWith("  Format: json");
    });

    it("returns result from run function", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt"]);

      expect(result.exitCode).toBe(0);
      expect(result.result).toEqual({ processed: true, format: "json" });
    });

    it("enables verbose mode with -v", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt", "-v"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("[setup] Initializing...");
      expect(consoleSpy).toHaveBeenCalledWith("[run] Processing...");
      expect(consoleSpy).toHaveBeenCalledWith("[cleanup] Cleaning up...");
    });

    it("uses custom format with -f", async () => {
      const result = await runCommand(cli, ["file.txt", "-o", "out.txt", "-f", "yaml"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Format: yaml");
      expect(result.result).toEqual({ processed: true, format: "yaml" });
    });
  });

  describe("init subcommand", () => {
    it("initializes with default template", async () => {
      const result = await runCommand(cli, ["init"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Initializing project "my-project" with template "default"...',
      );
      expect(consoleSpy).toHaveBeenCalledWith("Done!");
    });

    it("initializes with custom template using -t", async () => {
      const result = await runCommand(cli, ["init", "-t", "react"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Initializing project "my-project" with template "react"...',
      );
    });

    it("initializes with custom name using -n", async () => {
      const result = await runCommand(cli, ["init", "-n", "my-app"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Initializing project "my-app" with template "default"...',
      );
    });

    it("can run initCommand directly", async () => {
      const result = await runCommand(initCommand, ["-t", "vue", "-n", "vue-app"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Initializing project "vue-app" with template "vue"...',
      );
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("my-tool");
      expect(output).toContain("init");
    });
  });
});
