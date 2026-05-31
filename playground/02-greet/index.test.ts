import { describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("02-greet", () => {
  it("greets with default greeting", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["World"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("Hello, World!");
    }
    expect(console).toHaveBeenCalledWith("Hello, World!");
  });

  it("greets with custom greeting using --greeting", async () => {
    using _console = spyOnConsoleLog();
    const result = await runCommand(command, ["World", "--greeting", "Hi"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("Hi, World!");
    }
  });

  it("greets with custom greeting using -g alias", async () => {
    using _console = spyOnConsoleLog();
    const result = await runCommand(command, ["World", "-g", "Howdy"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("Howdy, World!");
    }
  });

  it("outputs in uppercase with --loud", async () => {
    using _console = spyOnConsoleLog();
    const result = await runCommand(command, ["World", "--loud"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("HELLO, WORLD!");
    }
  });

  it("outputs in uppercase with -l alias", async () => {
    using _console = spyOnConsoleLog();
    const result = await runCommand(command, ["World", "-l"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("HELLO, WORLD!");
    }
  });

  it("combines custom greeting and loud mode", async () => {
    using _console = spyOnConsoleLog();
    const result = await runCommand(command, ["World", "-g", "Hi", "-l"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("HI, WORLD!");
    }
  });

  it("fails when name is not provided", async () => {
    using _console = spyOnConsoleLog();
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    await assertDocMatch({
      command,
      files: { "playground/02-greet/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
