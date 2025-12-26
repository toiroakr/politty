import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { main } from "./18-union-types.js";

describe("18-union-types", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("token auth (first union option)", () => {
    it("authenticates with token", async () => {
      const result = await runCommand(main, ["--token", "abc123"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]);
      expect(output).toContainEqual({ token: "abc123" });
    });
  });

  describe("credentials auth (second union option)", () => {
    it("authenticates with username and password", async () => {
      const result = await runCommand(main, ["--username", "admin", "--password", "secret"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]);
      expect(output).toContainEqual({ username: "admin", password: "secret" });
    });
  });

  describe("help", () => {
    it("shows help with union options", async () => {
      const result = await runCommand(main, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("auth-demo");
      expect(output).toContain("--token");
      expect(output).toContain("--username");
      expect(output).toContain("--password");
    });
  });

  it("fails when no auth option is provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(main, []);

    expect(result.exitCode).toBe(1);
  });
});
