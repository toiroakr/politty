import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runCommand } from "../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../tests/utils/console.js";
import { main } from "./18-union-types.js";

describe("18-union-types", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("token auth (first union option)", () => {
    it("authenticates with token", async () => {
      const result = await runCommand(main, ["--token", "abc123"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs();
      expect(output).toContain('{"token":"abc123"}');
    });
  });

  describe("credentials auth (second union option)", () => {
    it("authenticates with username and password", async () => {
      const result = await runCommand(main, ["--username", "admin", "--password", "secret"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs();
      expect(output).toContain('{"username":"admin","password":"secret"}');
    });
  });

  describe("help", () => {
    it("shows help with union options", async () => {
      const result = await runCommand(main, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("auth-demo");
      expect(output).toContain("--token");
      expect(output).toContain("--username");
      expect(output).toContain("--password");
    });
  });

  it("fails when no auth option is provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(main, []);

    expect(result.exitCode).toBe(1);
  });
});
