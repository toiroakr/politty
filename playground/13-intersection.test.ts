import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./13-intersection.js";

describe("13-intersection", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("processes file with required options", async () => {
    const result = await runCommand(command, ["input.txt", "-o", "output.txt"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("Processing file:");
    expect(consoleSpy).toHaveBeenCalledWith("  Input: input.txt");
    expect(consoleSpy).toHaveBeenCalledWith("  Output: output.txt");
    expect(consoleSpy).toHaveBeenCalledWith("Done!");
  });

  it("enables verbose mode with -v", async () => {
    const result = await runCommand(command, ["data.json", "-o", "result.json", "-v"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  (verbose mode enabled)");
    expect(consoleSpy).toHaveBeenCalledWith("  Step 1: Reading input file...");
    expect(consoleSpy).toHaveBeenCalledWith("  Step 2: Processing data...");
    expect(consoleSpy).toHaveBeenCalledWith("  Step 3: Writing output file...");
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
    expect(consoleSpy).toHaveBeenCalledWith("  Config: config.json");
  });

  it("suppresses output with -q (quiet mode)", async () => {
    const result = await runCommand(command, ["input.txt", "-o", "output.txt", "-q"]);

    expect(result.exitCode).toBe(0);
    // In quiet mode, only "Done!" should be printed
    expect(consoleSpy).not.toHaveBeenCalledWith("Processing file:");
    expect(consoleSpy).toHaveBeenCalledWith("Done!");
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
    expect(consoleSpy).toHaveBeenCalledWith("  Config: settings.json");
    expect(consoleSpy).toHaveBeenCalledWith("  (verbose mode enabled)");
  });

  it("fails when input is not provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["-o", "output.txt"]);

    expect(result.exitCode).toBe(1);
  });

  it("fails when output is not provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["input.txt"]);

    expect(result.exitCode).toBe(1);
  });
});
