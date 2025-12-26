import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import {
  cli,
  configGetCommand,
  configListCommand,
  remoteAddCommand,
  remoteRemoveCommand,
} from "./16-show-subcommand-options.js";

describe("16-show-subcommand-options", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("config get subcommand", () => {
    it("gets config value", async () => {
      const result = await runCommand(cli, ["config", "get", "user.name"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Getting config: user.name");
    });

    it("can run configGetCommand directly", async () => {
      const result = await runCommand(configGetCommand, ["core.editor"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Getting config: core.editor");
    });
  });

  describe("config set subcommand", () => {
    it("sets config value", async () => {
      const result = await runCommand(cli, ["config", "set", "user.name", "John"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Setting config: user.name = John");
    });
  });

  describe("config list subcommand", () => {
    it("lists config in default format", async () => {
      const result = await runCommand(cli, ["config", "list"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing all config (format: table, global: false):");
    });

    it("lists config in json format", async () => {
      const result = await runCommand(cli, ["config", "list", "-f", "json"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing all config (format: json, global: false):");
    });

    it("lists global config", async () => {
      const result = await runCommand(cli, ["config", "list", "-g"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing all config (format: table, global: true):");
    });

    it("can run configListCommand directly", async () => {
      const result = await runCommand(configListCommand, ["-f", "yaml"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing all config (format: yaml, global: false):");
    });
  });

  describe("remote add subcommand", () => {
    it("adds remote", async () => {
      const result = await runCommand(cli, [
        "remote",
        "add",
        "origin",
        "https://github.com/user/repo",
      ]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith(
        "Adding remote: origin -> https://github.com/user/repo",
      );
    });

    it("can run remoteAddCommand directly", async () => {
      const result = await runCommand(remoteAddCommand, ["upstream", "git@github.com:org/repo"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Adding remote: upstream -> git@github.com:org/repo");
    });
  });

  describe("remote remove subcommand", () => {
    it("removes remote", async () => {
      const result = await runCommand(cli, ["remote", "remove", "origin"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Removing remote: origin (force: false)");
    });

    it("removes remote with force", async () => {
      const result = await runCommand(cli, ["remote", "remove", "origin", "-f"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Removing remote: origin (force: true)");
    });

    it("can run remoteRemoveCommand directly", async () => {
      const result = await runCommand(remoteRemoveCommand, ["upstream", "-f"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Removing remote: upstream (force: true)");
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("git-like");
      expect(output).toContain("config");
      expect(output).toContain("remote");
    });

    it("shows help for config list subcommand", async () => {
      const result = await runCommand(cli, ["config", "list", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("list");
      expect(output).toContain("--format");
    });
  });
});
