import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { buildCommand, command, commonOptions, deployCommand, initCommand } from "./index.js";

const docConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
  command,
  rootDoc: {
    path: "playground/23-global-options-index-markers/REFERENCE.md",
    globalOptions: commonOptions,
  },
  files: {
    "playground/23-global-options-index-markers/README.md": ["init", "build", "deploy"],
  },
  formatter: mdFormatter,
};

describe("23-global-options-index-markers", () => {
  let consoleSpy: ConsoleSpy;

  beforeAll(() => {
    initDocFile("playground/23-global-options-index-markers/README.md");
  });

  beforeEach(() => {
    consoleSpy = spyOnConsoleLog();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("init command", () => {
    it("initializes a project with default template", async () => {
      const result = await runCommand(initCommand, ["my-app"]);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Initialized project "my-app" with template "default"',
      );
    });

    it("documentation", async () => {
      await assertDocMatch({
        ...docConfig,
        targetCommands: ["init"],
        examples: {},
      });
    });
  });

  describe("build command", () => {
    it("builds in default mode", async () => {
      const result = await runCommand(buildCommand, []);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("Building in development mode (single)");
    });

    it("documentation", async () => {
      await assertDocMatch({
        ...docConfig,
        targetCommands: ["build"],
        examples: {},
      });
    });
  });

  describe("deploy command", () => {
    it("deploys to staging with force", async () => {
      const result = await runCommand(deployCommand, ["--env", "staging", "--force"]);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("Deploying to staging (forced)");
    });

    it("documentation", async () => {
      await assertDocMatch({
        ...docConfig,
        targetCommands: ["deploy"],
        examples: {},
      });
    });
  });

  describe("globalOptions marker", () => {
    it("validates globalOptions table", async () => {
      await assertDocMatch({
        ...docConfig,
        examples: {},
      });
    });
  });

  describe("index marker", () => {
    it("validates commands index", async () => {
      await assertDocMatch({
        ...docConfig,
        examples: {},
      });
    });
  });
});
