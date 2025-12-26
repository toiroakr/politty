import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../tests/utils/console.js";
import { command } from "./13-intersection.js";

describe("13-intersection", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("processes file with required options", async () => {
    const result = await runCommand(command, ["input.txt", "-o", "output.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Processing file:");
    expect(console).toHaveBeenCalledWith("  Input: input.txt");
    expect(console).toHaveBeenCalledWith("  Output: output.txt");
    expect(console).toHaveBeenCalledWith("Done!");
  });

  it("enables verbose mode with -v", async () => {
    const result = await runCommand(command, ["data.json", "-o", "result.json", "-v"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (verbose mode enabled)");
    expect(console).toHaveBeenCalledWith("  Step 1: Reading input file...");
    expect(console).toHaveBeenCalledWith("  Step 2: Processing data...");
    expect(console).toHaveBeenCalledWith("  Step 3: Writing output file...");
  });

  it("uses config file with --config", async () => {
    const result = await runCommand(command, [
      "data.json",
      "-o",
      "result.json",
      "--config",
      "config.json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Config: config.json");
  });

  it("suppresses output with -q (quiet mode)", async () => {
    const result = await runCommand(command, ["input.txt", "-o", "output.txt", "-q"]);

    expect(result.exitCode).toBe(0);
    // In quiet mode, only "Done!" should be printed
    expect(console).not.toHaveBeenCalledWith("Processing file:");
    expect(console).toHaveBeenCalledWith("Done!");
  });

  it("combines verbose and config options", async () => {
    const result = await runCommand(command, [
      "data.json",
      "-o",
      "result.json",
      "-v",
      "-c",
      "settings.json",
    ]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Config: settings.json");
    expect(console).toHaveBeenCalledWith("  (verbose mode enabled)");
  });

  it("fails when input is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["-o", "output.txt"]);

    expect(result.exitCode).toBe(1);
  });

  it("fails when output is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["input.txt"]);

    expect(result.exitCode).toBe(1);
  });
});
