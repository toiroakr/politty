import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../tests/utils/console.js";
import { command } from "./09-convert-command.js";

describe("09-convert-command", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("converts with only input (output to stdout)", async () => {
    const result = await runCommand(command, ["input.json"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Input: input.json");
    expect(console).toHaveBeenCalledWith("  Output: stdout");
    expect(console).toHaveBeenCalledWith("  Format: json");
  });

  it("converts with input and output", async () => {
    const result = await runCommand(command, ["input.json", "output.yaml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Input: input.json");
    expect(console).toHaveBeenCalledWith("  Output: output.yaml");
  });

  it("uses specified format with -f", async () => {
    const result = await runCommand(command, ["input.json", "-f", "yaml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Format: yaml");
  });

  it("converts to toml format", async () => {
    const result = await runCommand(command, ["data.json", "-f", "toml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Format: toml");
  });

  it("uses all options together", async () => {
    const result = await runCommand(command, ["input.json", "output.yaml", "-f", "yaml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Input: input.json");
    expect(console).toHaveBeenCalledWith("  Output: output.yaml");
    expect(console).toHaveBeenCalledWith("  Format: yaml");
  });

  it("fails when input is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
