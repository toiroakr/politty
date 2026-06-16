import { beforeAll, describe, expect, it, vi } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

const docConfig: GenerateDocConfig = {
  command,
  templates: {
    "playground/30-template-docs/README.md": "playground/30-template-docs/README.template.md",
  },
  formatter: mdFormatter,
  examples: { add: true },
};

describe("30-template-docs", () => {
  // Initialize generated output before all tests (deletes file when update mode is enabled)
  beforeAll(() => {
    initDocFile(docConfig);
  });

  it("adds a task with default priority", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["add", "Buy milk"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ title: "Buy milk", priority: "mid" });
    }
    expect(console).toHaveBeenCalledWith("Added task: Buy milk (priority: mid)");
  });

  it("adds a task with explicit priority", async () => {
    using _console = spyOnConsoleLog();
    const result = await runCommand(command, ["add", "Ship release", "-p", "high"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ title: "Ship release", priority: "high" });
    }
  });

  it("lists open tasks by default", async () => {
    using console = spyOnConsoleLog();
    const result = await runCommand(command, ["list"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ done: false });
    }
    expect(console).toHaveBeenCalledWith("Listing open tasks");
  });

  it("lists all tasks with --done", async () => {
    using _console = spyOnConsoleLog();
    const result = await runCommand(command, ["list", "--done"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ done: true });
    }
  });

  it("fails when add is called without a title", async () => {
    using _console = spyOnConsoleLog();
    using _errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["add"]);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    using _console = spyOnConsoleLog();
    await assertDocMatch(docConfig);
  });
});
