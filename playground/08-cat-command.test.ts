import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./08-cat-command.js";

describe("08-cat-command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("displays single file", async () => {
    const result = await runCommand(command, ["file1.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Displaying 1 file(s):");
    expect(consoleSpy).toHaveBeenCalledWith("\n=== file1.txt ===");
  });

  it("displays multiple files", async () => {
    const result = await runCommand(command, ["file1.txt", "file2.txt", "file3.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Displaying 3 file(s):");
    expect(consoleSpy).toHaveBeenCalledWith("\n=== file1.txt ===");
    expect(consoleSpy).toHaveBeenCalledWith("\n=== file2.txt ===");
    expect(consoleSpy).toHaveBeenCalledWith("\n=== file3.txt ===");
  });

  it("shows line numbers with -n", async () => {
    const result = await runCommand(command, ["-n", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  (with line numbers)");
  });

  it("shows line ends with -E", async () => {
    const result = await runCommand(command, ["-E", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  (showing line ends)");
  });

  it("combines -n and -E options", async () => {
    const result = await runCommand(command, ["-n", "-E", "a.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  (with line numbers)");
    expect(consoleSpy).toHaveBeenCalledWith("  (showing line ends)");
  });

  it("fails when no files provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
