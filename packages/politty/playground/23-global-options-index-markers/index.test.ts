import { beforeAll, describe, expect, it } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { buildCommand, command, commonOptions, deployCommand, initCommand } from "./index.js";

const docConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
  command,
  rootDoc: {
    path: "playground/23-global-options-index-markers/REFERENCE.md",
    globalOptions: commonOptions,
    layout: (md) => md`
      # project-cli

      Project management CLI demonstrating docs markers

      ## Global Options

      These options are shared across \`build\` and \`deploy\` commands.

      ${md.globalOptions}

      ## Command Reference

      ${md.index}
    `,
  },
  files: {
    "playground/23-global-options-index-markers/README.md": ["init", "build", "deploy"],
  },
  formatter: mdFormatter,
};

describe("23-global-options-index-markers", () => {
  beforeAll(() => {
    initDocFile("playground/23-global-options-index-markers/README.md");
    initDocFile("playground/23-global-options-index-markers/README-CUSTOM-HEADING.md");
  });

  describe("init command", () => {
    it("initializes a project with default template", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(initCommand, ["my-app"]);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith(
        'Initialized project "my-app" with template "default"',
      );
    });

    it("documentation", async () => {
      using _console = spyOnConsoleLog();
      await assertDocMatch({
        ...docConfig,
        targetCommands: ["init"],
        examples: {},
      });
    });
  });

  describe("build command", () => {
    it("builds in default mode", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(buildCommand, []);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("Building in development mode (single)");
    });

    it("documentation", async () => {
      using _console = spyOnConsoleLog();
      await assertDocMatch({
        ...docConfig,
        targetCommands: ["build"],
        examples: {},
      });
    });
  });

  describe("deploy command", () => {
    it("deploys to staging with force", async () => {
      using consoleSpy = spyOnConsoleLog();
      const result = await runCommand(deployCommand, ["--env", "staging", "--force"]);

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith("Deploying to staging (forced)");
    });

    it("documentation", async () => {
      using _console = spyOnConsoleLog();
      await assertDocMatch({
        ...docConfig,
        targetCommands: ["deploy"],
        examples: {},
      });
    });
  });

  describe("globalOptions marker", () => {
    it("validates globalOptions table", async () => {
      using _console = spyOnConsoleLog();
      await assertDocMatch({
        ...docConfig,
        examples: {},
      });
    });
  });

  describe("index marker", () => {
    it("validates commands index", async () => {
      using _console = spyOnConsoleLog();
      await assertDocMatch({
        ...docConfig,
        examples: {},
      });
    });
  });

  describe("custom heading levels", () => {
    const customHeadingDocConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
      command,
      rootDoc: {
        path: "playground/23-global-options-index-markers/REFERENCE-CUSTOM-HEADING.md",
        globalOptions: commonOptions,
        headingLevel: 2,
        index: { headingLevel: 4 },
        // The command index is written literally so the regenerated doc stays
        // byte-identical (minus markers) to the original; `md.index` would
        // resolve links to README-CUSTOM-HEADING.md, but the original references
        // the shared README.md.
        layout: (md) => md`
          ## project-cli

          Project management CLI demonstrating docs markers

          ### Global Options

          These options are shared across \`build\` and \`deploy\` commands.

          ${md.globalOptions}

          ### Command Reference

          #### [init](./README.md)

          Initialize a new project

          | Command                      | Description              |
          | ---------------------------- | ------------------------ |
          | [init](./README.md#init)     | Initialize a new project |
          | [build](./README.md#build)   | Build the project        |
          | [deploy](./README.md#deploy) | Deploy the project       |
        `,
      },
      files: {
        "playground/23-global-options-index-markers/README-CUSTOM-HEADING.md": [
          "init",
          "build",
          "deploy",
        ],
      },
      formatter: mdFormatter,
    };

    it("validates rootDoc with custom heading levels", async () => {
      using _console = spyOnConsoleLog();
      await assertDocMatch({
        ...customHeadingDocConfig,
        examples: {},
      });
    });
  });
});
