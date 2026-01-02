import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("20-meta", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("greets with positional name (via meta)", async () => {
    const result = await runCommand(command, ["World"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Hello, World!");
  });

  it("greets with custom greeting using -g (via meta)", async () => {
    const result = await runCommand(command, ["World", "-g", "Hi"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Hi, World!");
  });

  it("greets with custom greeting using --greeting (via meta)", async () => {
    const result = await runCommand(command, ["World", "--greeting", "Howdy"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Howdy, World!");
  });

  it("shows help with meta-defined options", async () => {
    const result = await runCommand(command, ["--help"]);

    expect(result.exitCode).toBe(0);
    const output = console.getLogs().join("\n");
    expect(output).toContain("greet-meta");
    expect(output).toContain("<name>");
    expect(output).toContain("Greeting phrase (via meta)");
  });

  it("fails when name is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/20-meta/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
