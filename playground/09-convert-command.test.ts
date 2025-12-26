import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./09-convert-command.js";

describe("09-convert-command", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("converts with only input (output to stdout)", async () => {
    const result = await runCommand(command, ["input.json"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  Input: input.json");
    expect(consoleSpy).toHaveBeenCalledWith("  Output: stdout");
    expect(consoleSpy).toHaveBeenCalledWith("  Format: json");
  });

  it("converts with input and output", async () => {
    const result = await runCommand(command, ["input.json", "output.yaml"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  Input: input.json");
    expect(consoleSpy).toHaveBeenCalledWith("  Output: output.yaml");
  });

  it("uses specified format with -f", async () => {
    const result = await runCommand(command, ["input.json", "-f", "yaml"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  Format: yaml");
  });

  it("converts to toml format", async () => {
    const result = await runCommand(command, ["data.json", "-f", "toml"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  Format: toml");
  });

  it("uses all options together", async () => {
    const result = await runCommand(command, ["input.json", "output.yaml", "-f", "yaml"]);

    expect(result.exitCode).toBe(0);
    expect(consoleSpy).toHaveBeenCalledWith("  Input: input.json");
    expect(consoleSpy).toHaveBeenCalledWith("  Output: output.yaml");
    expect(consoleSpy).toHaveBeenCalledWith("  Format: yaml");
  });

  it("fails when input is not provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
