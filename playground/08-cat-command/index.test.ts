import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { oxfmtFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("08-cat-command", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("displays single file", async () => {
    const result = await runCommand(command, ["file1.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Displaying 1 file(s):");
    expect(console).toHaveBeenCalledWith("\n=== file1.txt ===");
  });

  it("displays multiple files", async () => {
    const result = await runCommand(command, ["file1.txt", "file2.txt", "file3.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Displaying 3 file(s):");
    expect(console).toHaveBeenCalledWith("\n=== file1.txt ===");
    expect(console).toHaveBeenCalledWith("\n=== file2.txt ===");
    expect(console).toHaveBeenCalledWith("\n=== file3.txt ===");
  });

  it("shows line numbers with -n", async () => {
    const result = await runCommand(command, ["-n", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (with line numbers)");
  });

  it("shows line ends with -E", async () => {
    const result = await runCommand(command, ["-E", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (showing line ends)");
  });

  it("combines -n and -E options", async () => {
    const result = await runCommand(command, ["-n", "-E", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (with line numbers)");
    expect(console).toHaveBeenCalledWith("  (showing line ends)");
  });

  it("fails when no files provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/08-cat-command/README.md": [""] },
      formatter: oxfmtFormatter,
    });
  });
});
