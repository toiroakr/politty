import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import {
    cli,
    configCoreGetCommand,
    configCoreSetCommand,
    configUserGetCommand,
    configUserSetCommand
} from "./index.js";

describe("17-deep-nested-subcommands", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("config user get subcommand", () => {
    it("gets user config value", async () => {
      const result = await runCommand(cli, ["config", "user", "get", "name"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("user.name = John Doe");
    });

    it("handles unknown key", async () => {
      const result = await runCommand(cli, ["config", "user", "get", "unknown"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("user.unknown = (not set)");
    });

    it("can run configUserGetCommand directly", async () => {
      const result = await runCommand(configUserGetCommand, ["email"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("user.email = john@example.com");
    });
  });

  describe("config user set subcommand", () => {
    it("sets user config value (local)", async () => {
      const result = await runCommand(cli, ["config", "user", "set", "name", "John Doe"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Setting user.name = John Doe (local)");
    });

    it("sets user config value (global)", async () => {
      const result = await runCommand(cli, ["config", "user", "set", "name", "Jane Doe", "-g"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Setting user.name = Jane Doe (global)");
    });

    it("can run configUserSetCommand directly", async () => {
      const result = await runCommand(configUserSetCommand, [
        "email",
        "test@example.com",
        "--global",
      ]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Setting user.email = test@example.com (global)");
    });
  });

  describe("config core get subcommand", () => {
    it("gets core config value", async () => {
      const result = await runCommand(cli, ["config", "core", "get", "editor"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("core.editor = vim");
    });

    it("handles unknown key", async () => {
      const result = await runCommand(cli, ["config", "core", "get", "unknown"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("core.unknown = (not set)");
    });

    it("can run configCoreGetCommand directly", async () => {
      const result = await runCommand(configCoreGetCommand, ["pager"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("core.pager = less");
    });
  });

  describe("config core set subcommand", () => {
    it("sets core config value", async () => {
      const result = await runCommand(cli, ["config", "core", "set", "editor", "nano"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Setting core.editor = nano");
    });

    it("can run configCoreSetCommand directly", async () => {
      const result = await runCommand(configCoreSetCommand, ["pager", "more"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Setting core.pager = more");
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
      expect(output).toContain("user");
      expect(output).toContain("core");
    });

    it("shows help for config user subcommand", async () => {
      const result = await runCommand(cli, ["config", "user", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("user");
      expect(output).toContain("get");
      expect(output).toContain("set");
    });

    it("shows help for config user get subcommand", async () => {
      const result = await runCommand(cli, ["config", "user", "get", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("get");
    });
  });

  it("documentation", async () => {
    await assertDocMatch({
      command: cli,
      files: { "playground/17-deep-nested-subcommands/README.md": [""] },
    });
  });
});
