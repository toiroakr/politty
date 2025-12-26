import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runCommand } from "../src/index.js";
import {
  cli,
  configGetCommand,
  configSetCommand,
  configListCommand,
} from "./11-nested-subcommands.js";

describe("11-nested-subcommands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("config get subcommand", () => {
    it("gets config value via nested path", async () => {
      const result = await runCommand(cli, ["config", "get", "user.name"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Getting config: user.name");
      expect(consoleSpy).toHaveBeenCalledWith("  Value: (simulated value for user.name)");
    });

    it("can run configGetCommand directly", async () => {
      const result = await runCommand(configGetCommand, ["user.email"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Getting config: user.email");
    });

    it("fails when key is not provided", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const result = await runCommand(cli, ["config", "get"]);

      expect(result.exitCode).toBe(1);
    });
  });

  describe("config set subcommand", () => {
    it("sets config value via nested path", async () => {
      const result = await runCommand(cli, ["config", "set", "user.name", "John Doe"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Setting config: user.name = John Doe");
    });

    it("can run configSetCommand directly", async () => {
      const result = await runCommand(configSetCommand, ["user.email", "john@example.com"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Setting config: user.email = john@example.com");
    });
  });

  describe("config list subcommand", () => {
    it("lists all config with default format", async () => {
      const result = await runCommand(cli, ["config", "list"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing all config (format: table):");
      expect(consoleSpy).toHaveBeenCalledWith("  user.name = John");
    });

    it("lists all config in json format", async () => {
      const result = await runCommand(cli, ["config", "list", "--format", "json"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing all config (format: json):");
    });

    it("can run configListCommand directly", async () => {
      const result = await runCommand(configListCommand, ["-f", "yaml"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing all config (format: yaml):");
    });
  });

  describe("help", () => {
    it("shows help for main CLI", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("git-like");
      expect(output).toContain("config");
    });

    it("shows help for config subcommand", async () => {
      const result = await runCommand(cli, ["config", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.mock.calls.map((c: unknown[]) => c[0]).join("\n");
      expect(output).toContain("config");
      expect(output).toContain("get");
      expect(output).toContain("set");
      expect(output).toContain("list");
    });
  });
});
