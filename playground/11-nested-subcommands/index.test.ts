import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { cli, configGetCommand, configListCommand, configSetCommand } from "./index.js";

describe("11-nested-subcommands", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("config get subcommand", () => {
    it("gets config value via nested path", async () => {
      const result = await runCommand(cli, ["config", "get", "user.name"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Getting config: user.name");
      expect(console).toHaveBeenCalledWith("  Value: (simulated value for user.name)");
    });

    it("can run configGetCommand directly", async () => {
      const result = await runCommand(configGetCommand, ["user.email"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Getting config: user.email");
    });

    it("fails when key is not provided", async () => {
      vi.spyOn(globalThis.console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["config", "get"]);

      expect(result.exitCode).toBe(1);
    });
  });

  describe("config set subcommand", () => {
    it("sets config value via nested path", async () => {
      const result = await runCommand(cli, ["config", "set", "user.name", "John Doe"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Setting config: user.name = John Doe");
    });

    it("can run configSetCommand directly", async () => {
      const result = await runCommand(configSetCommand, ["user.email", "john@example.com"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Setting config: user.email = john@example.com");
    });
  });

  describe("config list subcommand", () => {
    it("lists all config with default format", async () => {
      const result = await runCommand(cli, ["config", "list"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Listing all config (format: table):");
      expect(console).toHaveBeenCalledWith("  user.name = John");
    });

    it("lists all config in json format", async () => {
      const result = await runCommand(cli, ["config", "list", "--format", "json"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Listing all config (format: json):");
    });

    it("can run configListCommand directly", async () => {
      const result = await runCommand(configListCommand, ["-f", "yaml"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Listing all config (format: yaml):");
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("git-like");
      expect(output).toContain("config");
    });

    it("shows help for config subcommand", async () => {
      const result = await runCommand(cli, ["config", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("config");
      expect(output).toContain("get");
      expect(output).toContain("set");
      expect(output).toContain("list");
    });
  });

  it("documentation", async () => {
    await assertDocMatch({
      command: cli,
      files: { "playground/11-nested-subcommands/README.md": [""] },
      formatter: mdFormatter,
    });
  });
});
