import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../tests/utils/console.js";
import { command } from "./04-type-coercion.js";

describe("04-type-coercion", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  it("parses port as number", async () => {
    const result = await runCommand(command, ["-p", "8080"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Port: 8080 (type: number)");
  });

  it("uses default count when not specified", async () => {
    const result = await runCommand(command, ["--port", "3000"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Count: 1 (type: number)");
  });

  it("parses count as number", async () => {
    const result = await runCommand(command, ["-p", "8080", "-n", "5"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Count: 5 (type: number)");
  });

  it("uses default host when not specified", async () => {
    const result = await runCommand(command, ["-p", "8080"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Host: localhost");
  });

  it("uses custom host with -h", async () => {
    const result = await runCommand(command, ["-p", "8080", "-h", "0.0.0.0"]);

    expect(result.exitCode).toBe(0);
    expect(console).toHaveBeenCalledWith("  Host: 0.0.0.0");
  });

  it("fails when port is invalid (too high)", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, ["-p", "99999"]);

    expect(result.exitCode).toBe(1);
  });

  it("fails when port is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
