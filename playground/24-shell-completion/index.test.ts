import { describe, expect, it } from "vitest";
import {
  CompletionDirective,
  formatForShell,
  generateCandidates,
  generateCompletion,
  parseCompletionContext,
} from "../../src/completion/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { buildCommand, cli, deployCommand, testCommand } from "./index.js";

describe("24-shell-completion", () => {
  describe("subcommands", () => {
    it("runs build command", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(buildCommand, ["-f", "json"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Building (format: json, output: dist, minify: false)");
    });

    it("runs deploy command", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(deployCommand, ["-e", "staging", "-n"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Deploying to staging (dry run)");
    });

    it("runs test command", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(testCommand, ["unit", "-w"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Running unit tests (watch mode)");
    });
  });

  describe("completion command", () => {
    it("generates bash completion script", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(cli, ["completion", "bash"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("_myapp_completions");
      expect(output).toContain("complete -o default -F _myapp_completions myapp");
    });

    it("generates zsh completion script", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(cli, ["completion", "zsh"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("#compdef myapp");
      expect(output).toContain("compdef _myapp myapp");
    });

    it("generates fish completion script", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(cli, ["completion", "fish"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("__fish_myapp_complete");
      expect(output).toContain("complete -c myapp -f");
    });

    it("shows install instructions with -i", async () => {
      using console = spyOnConsoleLog();
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
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("build");
      expect(values).toContain("deploy");
      expect(values).toContain("test");
      expect(values).not.toContain("__complete");
    });

    it("does not show options alongside subcommands at root level", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", ""]);
      const values = getCompletionValues(console);

      expect(values).not.toContain("--verbose");
      expect(values).not.toContain("-v");
    });

    it("completes options for subcommand", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", "build", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("--format");
      expect(values).toContain("--output");
      expect(values).toContain("--minify");
      expect(values).not.toContain("-f");
      expect(values).not.toContain("-o");
    });

    it("completes options with -- prefix for subcommand", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", "deploy", "--"]);
      const values = getCompletionValues(console);

      expect(values).toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("completes enum values for option", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", "build", "--format", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("json");
      expect(values).toContain("yaml");
      expect(values).toContain("xml");
    });

    it("completes custom choices for option", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", "deploy", "--env", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("development");
      expect(values).toContain("staging");
      expect(values).toContain("production");
    });

    it("completes positional enum values", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", "test", ""]);
      const values = getCompletionValues(console);

      expect(values).toContain("unit");
      expect(values).toContain("integration");
      expect(values).toContain("e2e");
    });

    it("filters out used options", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, [
        "__complete",
        "--shell",
        "fish",
        "--",
        "deploy",
        "--env",
        "staging",
        "--",
      ]);
      const values = getCompletionValues(console);

      expect(values).not.toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("passes file extensions to shell via @ext: metadata (no FileCompletion directive)", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", "deploy", "--config", ""]);
      const output = console.getLogs().join("\n");

      // deploy --config has extensions specified, so extensions are passed to shell via @ext: metadata
      // Directive should be FilterPrefix(4) only — shell handles file completion natively
      expect(output).toContain("@ext:json,yaml,yml");
      expect(output).toContain(":4");
      expect(output).not.toContain(":20"); // NOT FileCompletion(16) | FilterPrefix(4)
    });

    it("returns directory directive for directory completion", async () => {
      using console = spyOnConsoleLog();
      await runCommand(cli, ["__complete", "--shell", "fish", "--", "build", "--output", ""]);
      const output = console.getLogs().join("\n");

      expect(output).toContain(":36"); // FilterPrefix(4) | DirectoryCompletion(32)
    });
  });

  describe("dynamic completion (via parseCompletionContext + generateCandidates)", () => {
    it("completes subcommands at root level", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext([""], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("build");
      expect(values).toContain("deploy");
      expect(values).toContain("test");
    });

    it("completes options for deploy subcommand", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["deploy", "--"], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("completes enum values for build --format", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["build", "--format", ""], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("json");
      expect(values).toContain("yaml");
      expect(values).toContain("xml");
    });

    it("completes custom choices for deploy --env", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["deploy", "--env", ""], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("development");
      expect(values).toContain("staging");
      expect(values).toContain("production");
    });

    it("resolves file completion with extensions in JS for deploy --config", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["deploy", "--config", ""], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });

      // deploy --config has extensions, so resolved in JS (no FileCompletion directive)
      expect(result.directive & CompletionDirective.FileCompletion).toBeFalsy();
      // Candidates may include matching files from the current directory
      expect(result.candidates.every((c) => !c.value.startsWith("__extensions:"))).toBe(true);
    });

    it("returns directory directive for build --output", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["build", "--output", ""], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });

      expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
    });

    it("completes positional enum for test suite", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["test", ""], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });
      const values = result.candidates.map((c) => c.value);

      expect(values).toContain("unit");
      expect(values).toContain("integration");
      expect(values).toContain("e2e");
    });

    it("filters out used options", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["deploy", "--env", "staging", "--"], cli);
      const result = await generateCandidates(ctx, { shell: "bash" });
      const values = result.candidates.map((c) => c.value);

      expect(values).not.toContain("--env");
      expect(values).toContain("--config");
      expect(values).toContain("--dry-run");
    });

    it("formats output for shell consumption", async () => {
      using _console = spyOnConsoleLog();
      const ctx = parseCompletionContext(["deploy", "--env", ""], cli);
      const result = await generateCandidates(ctx, { shell: "fish" });
      const output = formatForShell(result, { shell: "fish", currentWord: "" });
      const lines = output.split("\n");

      expect(lines.some((l: string) => l.startsWith("development"))).toBe(true);
      expect(lines.some((l: string) => l.startsWith("staging"))).toBe(true);
      expect(lines.some((l: string) => l.startsWith("production"))).toBe(true);
      // Last line is directive
      expect(lines[lines.length - 1]).toMatch(/^:\d+$/);
    });
  });

  describe("completion API (programmatic)", () => {
    it("generates completion script via API", () => {
      using _console = spyOnConsoleLog();
      const result = generateCompletion(cli, {
        shell: "bash",
        programName: "myapp",
      });

      expect(result.shell).toBe("bash");
      expect(result.script).toContain("_myapp_completions");
    });
  });
});
