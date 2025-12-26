import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { cli, transformCommand, refineCommand } from "./14-transform-refine.js";

describe("14-transform-refine", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("transform subcommand", () => {
    it("transforms name to uppercase", async () => {
      const result = await runCommand(cli, ["transform", "hello", "--tags", "a,b,c"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Name: HELLO (uppercased)");
    });

    it("splits comma-separated tags into array", async () => {
      const result = await runCommand(cli, ["transform", "world", "-t", "tag1,tag2"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        '  Tags: ["tag1","tag2"] (split from comma-separated)',
      );
    });

    it("can run transformCommand directly", async () => {
      const result = await runCommand(transformCommand, ["TEST", "--tags", "x,y,z"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Name: TEST (uppercased)");
    });

    it("fails when name is not provided", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["transform", "--tags", "a"]);

      expect(result.exitCode).toBe(1);
    });

    it("fails when tags is not provided", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["transform", "hello"]);

      expect(result.exitCode).toBe(1);
    });
  });

  describe("refine subcommand", () => {
    it("passes when input and output are different", async () => {
      const result = await runCommand(cli, ["refine", "input.txt", "output.txt"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Refine example:");
      expect(consoleSpy).toHaveBeenCalledWith("  Input: input.txt");
      expect(consoleSpy).toHaveBeenCalledWith("  Output: output.txt");
      expect(consoleSpy).toHaveBeenCalledWith("  (validation passed: input !== output)");
    });

    it("fails when input and output are the same", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["refine", "same.txt", "same.txt"]);

      expect(result.exitCode).toBe(1);
    });

    it("can run refineCommand directly", async () => {
      const result = await runCommand(refineCommand, ["a.txt", "b.txt"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Input: a.txt");
      expect(consoleSpy).toHaveBeenCalledWith("  Output: b.txt");
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("validation-demo");
      expect(output).toContain("transform");
      expect(output).toContain("refine");
    });
  });
});
