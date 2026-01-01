import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { oxfmtFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("03-array-args", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("processes single file with --files", async () => {
    const result = await runCommand(command, ["--files", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Processing 1 files:");
    expect(console).toHaveBeenCalledWith("  - a.txt");
  });

  it("processes multiple files with repeated --files", async () => {
    const result = await runCommand(command, [
      "--files",
      "a.txt",
      "--files",
      "b.txt",
      "--files",
      "c.txt",
    ]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Processing 3 files:");
    expect(console).toHaveBeenCalledWith("  - a.txt");
    expect(console).toHaveBeenCalledWith("  - b.txt");
    expect(console).toHaveBeenCalledWith("  - c.txt");
  });

  it("processes files with -f alias", async () => {
    const result = await runCommand(command, ["-f", "one.txt", "-f", "two.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Processing 2 files:");
  });

  it("shows verbose output with -v", async () => {
    const result = await runCommand(command, ["-f", "test.txt", "-v"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  - Processing: test.txt");
  });

  it("fails when no files provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/03-array-args/README.md": [""] },
      formatter: oxfmtFormatter,
    });
  });
});
