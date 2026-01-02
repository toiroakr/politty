import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("01-hello-world", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("outputs 'Hello, World!'", async () => {
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("Hello, World!");
  });

  it("shows help with --help", async () => {
    const result = await runCommand(command, ["--help"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalled();
    const output = console.getLogs().join("\n");
    expect(output).toContain("hello");
    expect(output).toContain("Hello Worldを表示するシンプルなコマンド");
  });

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/01-hello-world/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
