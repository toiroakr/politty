import { describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("06-cp-command", () => {
  it("copies source to destination", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["source.txt", "dest.txt"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Copying: source.txt -> dest.txt");
  });

  it("enables recursive mode with -r", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["/path/from", "/path/to", "-r"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (recursive mode)");
  });

  it("enables force mode with -f", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["file1.txt", "file2.txt", "-f"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (force mode)");
  });

  it("combines recursive and force modes", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["src", "dst", "-r", "-f"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  (recursive mode)");
    expect(console).toHaveBeenCalledWith("  (force mode)");
  });

  it("fails when source is not provided", async () => {
    using _console = spyOnConsoleLog();
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("fails when destination is not provided", async () => {
    using _console = spyOnConsoleLog();
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["source.txt"]);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    await assertDocMatch({
      command,
      files: { "playground/06-cp-command/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
