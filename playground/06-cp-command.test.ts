import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../tests/utils/console.js";
import { command } from "./06-cp-command.js";

describe("06-cp-command", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("copies source to destination", async () => {
    const result = await runCommand(command, ["source.txt", "dest.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Copying: source.txt -> dest.txt");
  });

  it("enables recursive mode with -r", async () => {
    const result = await runCommand(command, ["/path/from", "/path/to", "-r"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (recursive mode)");
  });

  it("enables force mode with -f", async () => {
    const result = await runCommand(command, ["file1.txt", "file2.txt", "-f"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (force mode)");
  });

  it("combines recursive and force modes", async () => {
    const result = await runCommand(command, ["src", "dst", "-r", "-f"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (recursive mode)");
    expect(console).toHaveBeenCalledWith("  (force mode)");
  });

  it("fails when source is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("fails when destination is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["source.txt"]);

    expect(result.exitCode).toBe(1);
  });
});
