import { beforeAll, describe, expect, it } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { cli } from "./index.js";

const baseDocConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
  command: cli,
  files: {
    "playground/27-custom-negation/README.md": [""],
  },
  formatter: mdFormatter,
};

describe("27-custom-negation", () => {
  beforeAll(() => {
    initDocFile(baseDocConfig);
  });

  describe("custom negation parsing", () => {
    it("uses default values when no flags are given", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, []);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("cache: true");
      expect(consoleSpy).toHaveBeenCalledWith("color: true");
      expect(consoleSpy).toHaveBeenCalledWith("pretty: true");
      expect(consoleSpy).toHaveBeenCalledWith("verbose: false");
    });

    it("accepts --disable-cache as the negation of --cache", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--disable-cache"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("cache: false");
      expect(consoleSpy).toHaveBeenCalledWith("color: true");
    });

    it("accepts the camelCase variant --disableCache", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--disableCache"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("cache: false");
    });

    it("accepts --monochrome as the negation of --color", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--monochrome"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("cache: true");
      expect(consoleSpy).toHaveBeenCalledWith("color: false");
    });

    it("ignores the default --no-cache form when negation is configured", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--no-cache"]);

      // Unknown option is a warning, not an error; cache stays at its default
      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("cache: true");
    });

    it("flips verbose on via --verbose when negation is disabled", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--verbose"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("verbose: true");
    });

    it("accepts --no-pretty (advertised default negation) when negation: true", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--no-pretty"]);

      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("pretty: false");
    });

    it("ignores --no-verbose when negation: false suppresses the default form", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--no-verbose"]);

      // Unknown option is a warning, not an error; verbose stays at its default
      expect(result.exitCode).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith("verbose: false");
    });
  });

  describe("help", () => {
    it("renders negation inline when no negationDescription is set", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");

      // `cache` has no negationDescription → inline display, joined with `/`
      expect(output).toMatch(/--cache\s+\/\s+--disable-cache/);
      // Default `--no-cache` should not appear
      expect(output).not.toContain("--no-cache");
    });

    it("renders negation on a separate line when negationDescription is set", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");

      // `color` has negationDescription → separate help line
      expect(output).toContain("--color");
      expect(output).toContain("--monochrome");
      expect(output).toContain("Disable colorized output");
      // The monochrome line is rendered separately from the --color line
      expect(output).not.toMatch(/--color\s+\/\s+--monochrome/);
    });

    it("shows only --verbose without any negation form when negation: false", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");

      expect(output).toContain("--verbose");
      expect(output).not.toContain("--no-verbose");
      // No `/` separator should appear next to --verbose
      expect(output).not.toMatch(/--verbose\s+\//);
    });

    it("advertises --pretty / --no-pretty in help when negation: true", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(cli, ["--help"]);

      expect(result.exitCode).toBe(0);
      const output = consoleSpy.getLogs().join("\n");

      expect(output).toMatch(/--pretty\s+\/\s+--no-pretty/);
    });
  });

  describe("documentation", () => {
    it("root command", async () => {
      using _console = spyOnConsoleLog();
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: [""],
      });
    });
  });
});
