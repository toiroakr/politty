import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { main } from "./19-xor-types.js";

describe("19-xor-types", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("token auth (first xor option)", () => {
    it("authenticates with token", async () => {
      const result = await runCommand(main, ["--token", "abc123"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Authenticated with token:", "abc123");
    });
  });

  describe("credentials auth (second xor option)", () => {
    it("authenticates with username and password", async () => {
      const result = await runCommand(main, ["--username", "admin", "--password", "secret"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Authenticated with credentials:");
      expect(consoleSpy).toHaveBeenCalledWith("  Username:", "admin");
      expect(consoleSpy).toHaveBeenCalledWith("  Password:", "secret");
    });
  });

  describe("help", () => {
    it("shows help with xor options", async () => {
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
