import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import { command } from "./12-discriminated-union.js";

describe("12-discriminated-union", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("create action", () => {
    it("creates resource with name", async () => {
      const result = await runCommand(command, ["--action", "create", "--name", "my-resource"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Creating resource:");
      expect(consoleSpy).toHaveBeenCalledWith("  Name: my-resource");
    });

    it("creates resource with template", async () => {
      const result = await runCommand(command, [
        "--action",
        "create",
        "--name",
        "my-resource",
        "--template",
        "basic",
      ]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Template: basic");
    });
  });

  describe("delete action", () => {
    it("deletes resource by id", async () => {
      const result = await runCommand(command, ["--action", "delete", "--id", "123"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Deleting resource:");
      expect(consoleSpy).toHaveBeenCalledWith("  ID: 123");
    });

    it("deletes resource with force mode", async () => {
      const result = await runCommand(command, ["--action", "delete", "--id", "456", "--force"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  (force mode - no confirmation)");
    });
  });

  describe("list action", () => {
    it("lists resources with default format", async () => {
      const result = await runCommand(command, ["--action", "list"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing resources:");
      expect(consoleSpy).toHaveBeenCalledWith("  Format: table");
      expect(consoleSpy).toHaveBeenCalledWith("  Limit: 10");
    });

    it("lists resources in json format", async () => {
      const result = await runCommand(command, ["--action", "list", "-f", "json"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Format: json");
    });

    it("lists resources with custom limit", async () => {
      const result = await runCommand(command, ["--action", "list", "-n", "5"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  Limit: 5");
    });
  });

  it("fails when action is not provided", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });
});
