import { describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { cli, refineCommand, transformCommand } from "./index.js";

describe("14-transform-refine", () => {
  describe("transform subcommand", () => {
    it("transforms name to uppercase", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(cli, ["transform", "hello", "--tags", "a,b,c"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Name: HELLO (uppercased)");
    });

    it("splits comma-separated tags into array", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(cli, ["transform", "world", "-t", "tag1,tag2"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith('  Tags: ["tag1","tag2"] (split from comma-separated)');
    });

    it("can run transformCommand directly", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(transformCommand, ["TEST", "--tags", "x,y,z"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Name: TEST (uppercased)");
    });

    it("fails when name is not provided", async () => {
      using _console = spyOnConsoleLog();
      vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["transform", "--tags", "a"]);

      expect(result.exitCode).toBe(1);
    });

    it("fails when tags is not provided", async () => {
      using _console = spyOnConsoleLog();
      vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["transform", "hello"]);

      expect(result.exitCode).toBe(1);
    });
  });

  describe("refine subcommand", () => {
    it("passes when input and output are different", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(cli, ["refine", "input.txt", "output.txt"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Refine example:");
      expect(console).toHaveBeenCalledWith("  Input: input.txt");
      expect(console).toHaveBeenCalledWith("  Output: output.txt");
      expect(console).toHaveBeenCalledWith("  (validation passed: input !== output)");
    });

    it("fails when input and output are the same", async () => {
      using _console = spyOnConsoleLog();
      vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["refine", "same.txt", "same.txt"]);

      expect(result.exitCode).toBe(1);
    });

    it("can run refineCommand directly", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(refineCommand, ["a.txt", "b.txt"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Input: a.txt");
      expect(console).toHaveBeenCalledWith("  Output: b.txt");
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      using console = spyOnConsoleLog();
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("validation-demo");
      expect(output).toContain("transform");
      expect(output).toContain("refine");
    });
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    await assertDocMatch({
      command: cli,
      files: { "playground/14-transform-refine/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
