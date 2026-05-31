import { describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("09-convert-command", () => {
  it("converts with only input (output to stdout)", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["input.json"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Input: input.json");
    expect(console).toHaveBeenCalledWith("  Output: stdout");
    expect(console).toHaveBeenCalledWith("  Format: json");
  });

  it("converts with input and output", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["input.json", "output.yaml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Input: input.json");
    expect(console).toHaveBeenCalledWith("  Output: output.yaml");
  });

  it("uses specified format with -f", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["input.json", "-f", "yaml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Format: yaml");
  });

  it("converts to toml format", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["data.json", "-f", "toml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Format: toml");
  });

  it("uses all options together", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["input.json", "output.yaml", "-f", "yaml"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Input: input.json");
    expect(console).toHaveBeenCalledWith("  Output: output.yaml");
    expect(console).toHaveBeenCalledWith("  Format: yaml");
  });

  it("fails when input is not provided", async () => {
    using _console = spyOnConsoleLog();
    using _errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    await assertDocMatch({
      command,
      files: { "playground/09-convert-command/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
