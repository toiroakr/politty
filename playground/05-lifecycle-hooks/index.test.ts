import { describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("05-lifecycle-hooks", () => {
  it("runs setup, run, and cleanup in order", async () => {
    using console = spyOnConsoleLog();
    using _errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});

    const result = await runCommand(command, [
      "--database",
      "postgres://localhost/mydb",
      "--query",
      "SELECT * FROM users",
    ]);

    expect(result.exitCode).toBe(0);

    const calls = console.getLogs();
    expect(calls).toContain("[setup] Connecting to database...");
    expect(calls).toContain("[setup] Connected!");
    expect(calls).toContain("[run] Executing query...");
    expect(calls).toContain("[run] Query completed!");
    expect(calls).toContain("[cleanup] Closing database connection...");
    expect(calls).toContain("[cleanup] Connection closed.");
  });

  it("returns result from run function", async () => {
    using _errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});

    const result = await runCommand(command, [
      "--database",
      "mysql://localhost/test",
      "--query",
      "SELECT 1",
    ]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ rowCount: 42, success: true });
    }
  });

  it("calls cleanup with error when run fails", async () => {
    using errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});

    const result = await runCommand(command, [
      "--database",
      "postgres://localhost/mydb",
      "--query",
      "SELECT * FROM users",
      "--simulate_error",
    ]);

    expect(result.exitCode).toBe(1);

    const errorCalls = errorSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(errorCalls).toContain("[cleanup] Error occurred: Simulated database error!");
  });

  it("fails when database is not provided", async () => {
    using _errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});

    const result = await runCommand(command, ["--query", "SELECT 1"]);

    expect(result.exitCode).toBe(1);
  });

  it("fails when query is not provided", async () => {
    using _errorSpy = vi.spyOn(globalThis.console, "error").mockImplementation(() => {});

    const result = await runCommand(command, ["--database", "postgres://localhost/mydb"]);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/05-lifecycle-hooks/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
