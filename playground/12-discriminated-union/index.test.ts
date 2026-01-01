import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { oxfmtFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

describe("12-discriminated-union", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("create action", () => {
    it("creates resource with name", async () => {
      const result = await runCommand(command, ["--action", "create", "--name", "my-resource"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Creating resource:");
      expect(console).toHaveBeenCalledWith("  Name: my-resource");
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
      expect(console).toHaveBeenCalledWith("  Template: basic");
    });
  });

  describe("delete action", () => {
    it("deletes resource by id", async () => {
      const result = await runCommand(command, ["--action", "delete", "--id", "123"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Deleting resource:");
      expect(console).toHaveBeenCalledWith("  ID: 123");
    });

    it("deletes resource with force mode", async () => {
      const result = await runCommand(command, ["--action", "delete", "--id", "456", "--force"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  (force mode - no confirmation)");
    });
  });

  describe("list action", () => {
    it("lists resources with default format", async () => {
      const result = await runCommand(command, ["--action", "list"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Listing resources:");
      expect(console).toHaveBeenCalledWith("  Format: table");
      expect(console).toHaveBeenCalledWith("  Limit: 10");
    });

    it("lists resources in json format", async () => {
      const result = await runCommand(command, ["--action", "list", "-F", "json"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Format: json");
    });

    it("lists resources with custom limit", async () => {
      const result = await runCommand(command, ["--action", "list", "-n", "5"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Limit: 5");
    });
  });

  it("fails when action is not provided", async () => {
    vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
    const result = await runCommand(command, []);

    expect(result.exitCode).toBe(1);
  });

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/12-discriminated-union/README.md": [""] },
      formatter: oxfmtFormatter,
    });
  });
});
