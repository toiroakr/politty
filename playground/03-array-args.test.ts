import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./03-array-args.js";

describe("03-array-args", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("processes single file with --files", async () => {
    const result = await runCommand(command, ["--files", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Processing 1 files:");
    expect(consoleSpy).toHaveBeenCalledWith("  - a.txt");
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
    expect(consoleSpy).toHaveBeenCalledWith("Processing 3 files:");
    expect(consoleSpy).toHaveBeenCalledWith("  - a.txt");
    expect(consoleSpy).toHaveBeenCalledWith("  - b.txt");
    expect(consoleSpy).toHaveBeenCalledWith("  - c.txt");
  });

  it("processes files with -f alias", async () => {
    const result = await runCommand(command, ["-f", "one.txt", "-f", "two.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Processing 2 files:");
  });

  it("shows verbose output with -v", async () => {
    const result = await runCommand(command, ["-f", "test.txt", "-v"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  - Processing: test.txt");
  });

  it("fails when no files provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
