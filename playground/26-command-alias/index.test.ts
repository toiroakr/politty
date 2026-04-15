import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { cli, installCommand, listCommand, removeCommand } from "./index.js";

const baseDocConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
  command: cli,
  files: {
    "playground/26-command-alias/README.md": ["", "install", "remove", "list"],
  },
  formatter: mdFormatter,
};

describe("26-command-alias", () => {
  let consoleSpy: ConsoleSpy;

  beforeAll(() => {
    initDocFile(baseDocConfig);
  });

  beforeEach(() => {
    consoleSpy = spyOnConsoleLog();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("install subcommand", () => {
    it("installs all dependencies with no args", async () => {
      const result = await runCommand(cli, ["install"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Installing all dependencies...");
    });

    it("installs specific packages", async () => {
      const result = await runCommand(cli, ["install", "lodash", "zod"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Installing as dependency:");
      expect(consoleSpy).toHaveBeenCalledWith("  + lodash");
      expect(consoleSpy).toHaveBeenCalledWith("  + zod");
    });

    it("installs as dev dependency with -D", async () => {
      const result = await runCommand(cli, ["install", "-D", "vitest"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Installing as devDependency:");
      expect(consoleSpy).toHaveBeenCalledWith("  + vitest");
    });

    it("works via alias 'i'", async () => {
      const result = await runCommand(cli, ["i", "lodash"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Installing as dependency:");
      expect(consoleSpy).toHaveBeenCalledWith("  + lodash");
    });

    it("works via alias 'add'", async () => {
      const result = await runCommand(cli, ["add", "lodash"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Installing as dependency:");
      expect(consoleSpy).toHaveBeenCalledWith("  + lodash");
    });

    it("can run installCommand directly", async () => {
      const result = await runCommand(installCommand, ["express"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  + express");
    });
  });

  describe("remove subcommand", () => {
    it("removes packages", async () => {
      const result = await runCommand(cli, ["remove", "lodash"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Removing:");
      expect(consoleSpy).toHaveBeenCalledWith("  - lodash");
    });

    it("works via alias 'rm'", async () => {
      const result = await runCommand(cli, ["rm", "lodash"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Removing:");
      expect(consoleSpy).toHaveBeenCalledWith("  - lodash");
    });

    it("works via alias 'uninstall'", async () => {
      const result = await runCommand(cli, ["uninstall", "lodash"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Removing:");
    });

    it("can run removeCommand directly", async () => {
      const result = await runCommand(removeCommand, ["express"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("  - express");
    });
  });

  describe("list subcommand", () => {
    it("lists packages", async () => {
      const result = await runCommand(cli, ["list"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing packages (depth: 0):");
    });

    it("works via alias 'ls'", async () => {
      const result = await runCommand(cli, ["ls"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing packages (depth: 0):");
    });

    it("accepts depth option", async () => {
      const result = await runCommand(cli, ["ls", "-d", "2"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing packages (depth: 2):");
    });

    it("can run listCommand directly", async () => {
      const result = await runCommand(listCommand, ["-d", "1"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("Listing packages (depth: 1):");
    });
  });

  describe("help", () => {
    it("shows aliases in main help", async () => {
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");
      // Aliases should appear next to the command name
      expect(output).toContain("install, i, add");
      expect(output).toContain("remove, rm, uninstall");
      expect(output).toContain("list, ls");
    });

    it("shows aliases when accessed by canonical name", async () => {
      const result = await runCommand(cli, ["install", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");
      expect(output).toContain("Aliases:");
      expect(output).toMatch(/i/);
      expect(output).toMatch(/add/);
    });

    it("shows 'Alias for' when accessed via alias", async () => {
      const result = await runCommand(cli, ["i", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");
      expect(output).toContain("Alias for");
      expect(output).toContain("install");
    });

    it("shows 'Alias for' for rm alias", async () => {
      const result = await runCommand(cli, ["rm", "--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");
      expect(output).toContain("Alias for");
      expect(output).toContain("remove");
    });
  });

  describe("documentation", () => {
    it("root command", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: [""],
      });
    });

    it("install command", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: ["install"],
      });
    });

    it("remove command", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: ["remove"],
      });
    });

    it("list command", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: ["list"],
      });
    });
  });
});
