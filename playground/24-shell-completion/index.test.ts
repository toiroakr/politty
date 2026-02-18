import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CompletionDirective,
  formatOutput,
  generateCandidates,
  generateCompletion,
  parseCompletionContext,
} from "../../src/completion/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { buildCommand, cli, deployCommand, testCommand } from "./index.js";

describe("24-shell-completion", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("subcommands", () => {
    it("runs build command", async () => {
      const result = await runCommand(buildCommand, ["-f", "json"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Building (format: json, output: dist, minify: false)");
    });

    it("runs deploy command", async () => {
      const result = await runCommand(deployCommand, ["-e", "staging", "-n"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Deploying to staging (dry run)");
    });

    it("runs test command", async () => {
      const result = await runCommand(testCommand, ["unit", "-w"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Running unit tests (watch mode)");
    });
  });

  describe("completion command", () => {
    it("generates bash completion script", async () => {
      const result = await runCommand(cli, ["completion", "bash"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("myapp __complete");
      expect(output).toContain("_myapp_completions");
    });

    it("generates zsh completion script", async () => {
      const result = await runCommand(cli, ["completion", "zsh"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("#compdef myapp");
      expect(output).toContain("myapp __complete");
    });

    it("generates fish completion script", async () => {
      const result = await runCommand(cli, ["completion", "fish"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("__fish_myapp_complete");
      expect(output).toContain("myapp __complete");
    });

    it("shows install instructions with -i", async () => {
      const result = await runCommand(cli, ["completion", "bash", "-i"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("~/.bashrc");
      expect(output).toContain('eval "$(myapp completion bash)"');
    });
  });

  describe("__complete via runCommand (E2E)", () => {
    function getCompletionOutput(consoleSpy: ConsoleSpy): string[] {
      return consoleSpy
        .getLogs()
        .join("\n")
        .split("\n")
        .filter((l: string) => !l.startsWith(":"));
    }

    function getCompletionValues(consoleSpy: ConsoleSpy): string[] {
      return getCompletionOutput(consoleSpy).map((l: string) => l.split("\t")[0]!);
    }

    it("completes subcommands at root level", async () => {
      await runCommand(cli, ["__complete", "--", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("build");
      expect(values).toContain("deploy");
      expect(values).toContain("test");
      expect(values).not.toContain("__complete");
    });

    it("does not show options alongside subcommands at root level", async () => {
      await runCommand(cli, ["__complete", "--", ""]);
      const values = getCompletionValues(console);

      expect(values).not.toContain("--verbose");
      expect(values).not.toContain("-v");
    });

    it("completes options for subcommand", async () => {
      await runCommand(cli, ["__complete", "--", "build", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("--format");
      expect(values).toContain("--output");
      expect(values).toContain("--minify");
      expect(values).not.toContain("-f");
      expect(values).not.toContain("-o");
    });

    it("completes options with -- prefix for subcommand", async () => {
      await runCommand(cli, ["__complete", "--", "deploy", "--"]);
      const values = getCompletionValues(console);

      expect(values).toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("completes enum values for option", async () => {
      await runCommand(cli, ["__complete", "--", "build", "--format", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("json");
      expect(values).toContain("yaml");
      expect(values).toContain("xml");
    });

    it("completes custom choices for option", async () => {
      await runCommand(cli, ["__complete", "--", "deploy", "--env", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("development");
      expect(values).toContain("staging");
      expect(values).toContain("production");
    });

    it("completes positional enum values", async () => {
      await runCommand(cli, ["__complete", "--", "test", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("unit");
      expect(values).toContain("integration");
      expect(values).toContain("e2e");
    });

    it("filters out used options", async () => {
      await runCommand(cli, ["__complete", "--", "deploy", "--env", "staging", "--"]);
      const values = getCompletionValues(console);

      expect(values).not.toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("returns filtered file candidates for file completion with extensions", async () => {
      await runCommand(cli, ["__complete", "--", "deploy", "--config", ""]);
      const values = getCompletionValues(console);
      const output = console.getLogs().join("\n");

      // With extensions, Node returns filtered candidates directly
      // Only FilterPrefix, not FileCompletion
      expect(output).toContain(":4"); // FilterPrefix(4)
      expect(output).not.toContain(":20");
      // Candidates include files and directories
      expect(values.length).toBeGreaterThan(0);
    });

    it("returns directory directive for directory completion", async () => {
      await runCommand(cli, ["__complete", "--", "build", "--output", ""]);
      const output = console.getLogs().join("\n");

      expect(output).toContain(":36"); // FilterPrefix(4) | DirectoryCompletion(32)
    });
  });

  describe("dynamic completion (via parseCompletionContext + generateCandidates)", () => {
    it("completes subcommands at root level", () => {
      const ctx = parseCompletionContext([""], cli);
      const result = generateCandidates(ctx);
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("build");
      expect(values).toContain("deploy");
      expect(values).toContain("test");
    });

    it("completes options for deploy subcommand", () => {
      const ctx = parseCompletionContext(["deploy", "--"], cli);
      const result = generateCandidates(ctx);
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("completes enum values for build --format", () => {
      const ctx = parseCompletionContext(["build", "--format", ""], cli);
      const result = generateCandidates(ctx);
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("json");
      expect(values).toContain("yaml");
      expect(values).toContain("xml");
    });

    it("completes custom choices for deploy --env", () => {
      const ctx = parseCompletionContext(["deploy", "--env", ""], cli);
      const result = generateCandidates(ctx);
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("development");
      expect(values).toContain("staging");
      expect(values).toContain("production");
    });

    it("returns filtered file candidates for deploy --config", () => {
      const ctx = parseCompletionContext(["deploy", "--config", ""], cli);
      const result = generateCandidates(ctx);

      // With extensions, returns candidates directly (not FileCompletion)
      expect(result.directive & CompletionDirective.FileCompletion).toBeFalsy();
      expect(result.candidates.length).toBeGreaterThan(0);
      // Directories are included for navigation
      expect(result.candidates.some((c) => c.type === "directory")).toBe(true);
    });

    it("returns directory directive for build --output", () => {
      const ctx = parseCompletionContext(["build", "--output", ""], cli);
      const result = generateCandidates(ctx);

      expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
    });

    it("completes positional enum for test suite", () => {
      const ctx = parseCompletionContext(["test", ""], cli);
      const result = generateCandidates(ctx);
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("unit");
      expect(values).toContain("integration");
      expect(values).toContain("e2e");
    });

    it("filters out used options", () => {
      const ctx = parseCompletionContext(["deploy", "--env", "staging", "--"], cli);
      const result = generateCandidates(ctx);
      const values = result.candidates.map((c) => c.value);

      expect(values).not.toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("formats output for shell consumption", () => {
      const ctx = parseCompletionContext(["deploy", "--env", ""], cli);
      const result = generateCandidates(ctx);
      const output = formatOutput(result);
      const lines = output.split("\n");

      expect(lines.some((l) => l.startsWith("development"))).toBe(true);
      expect(lines.some((l) => l.startsWith("staging"))).toBe(true);
      expect(lines.some((l) => l.startsWith("production"))).toBe(true);
      // Last line is directive
      expect(lines[lines.length - 1]).toMatch(/^:\d+$/);
    });
  });

  describe("completion API (programmatic)", () => {
    it("generates completion script via API", () => {
      const result = generateCompletion(cli, {
        shell: "bash",
        programName: "myapp",
      });

      expect(result.shell).toBe("bash");
      expect(result.script).toContain("myapp __complete");
    });
  });
});
