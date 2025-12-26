import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./05-lifecycle-hooks.js";

describe("05-lifecycle-hooks", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    errorSpy.mockRestore();
  });

  it("runs setup, run, and cleanup in order", async () => {
    const result = await runCommand(command, [
      "--database",
      "postgres://localhost/mydb",
      "--query",
      "SELECT * FROM users",
    ]);

    expect(result.exitCode).toBe(0);

    const calls = consoleSpy.mock.calls.map((c: unknown[]) => c[0]);
    expect(calls).toContain("[setup] Connecting to database...");
    expect(calls).toContain("[setup] Connected!");
    expect(calls).toContain("[run] Executing query...");
    expect(calls).toContain("[run] Query completed!");
    expect(calls).toContain("[cleanup] Closing database connection...");
    expect(calls).toContain("[cleanup] Connection closed.");
  });

  it("returns result from run function", async () => {
    const result = await runCommand(command, [
      "--database",
      "mysql://localhost/test",
      "--query",
      "SELECT 1",
    ]);

    expect(result.exitCode).toBe(0);
    expect(result.result).toEqual({ rowCount: 42, success: true });
  });

  it("calls cleanup with error when run fails", async () => {
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
    const result = await runCommand(command, ["--query", "SELECT 1"]);

    expect(result.exitCode).toBe(1);
  });

  it("fails when query is not provided", async () => {
    const result = await runCommand(command, ["--database", "postgres://localhost/mydb"]);

    expect(result.exitCode).toBe(1);
  });
});
