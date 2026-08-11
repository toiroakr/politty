import { beforeAll, describe, expect, it } from "vitest";
import { generateHelp } from "../../packages/core/src/output/help-generator.js";
import {
  assertDocMatch,
  type GenerateDocConfig,
  initDocFile,
} from "../../packages/zod/src/docs.js";
import { runCommand } from "../../packages/zod/src/index.js";
import { spyOnConsoleLog } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { command } from "./index.js";

const baseDocConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
  command,
  files: {
    "playground/32-multiline-descriptions/README.md": [""],
  },
  formatter: mdFormatter,
};

describe("32-multiline-descriptions", () => {
  beforeAll(() => {
    initDocFile(baseDocConfig);
  });

  it("deploys to staging with the default strategy", async () => {
    using consoleSpy = spyOnConsoleLog();
    const result = await runCommand(command, ["staging"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ target: "staging", strategy: "rolling", yes: false });
    }
    expect(consoleSpy).toHaveBeenCalledWith("Deploying to staging using the rolling strategy");
  });

  it("deploys to production with the recreate strategy", async () => {
    using _consoleSpy = spyOnConsoleLog();
    const result = await runCommand(command, ["production", "-s", "recreate", "-y"]);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toEqual({ target: "production", strategy: "recreate", yes: true });
    }
  });

  it("keeps multi-line descriptions aligned in terminal help", () => {
    const help = generateHelp(command, {});
    const lines = help.split("\n");

    // The second line of the --strategy description is on its own line,
    // indented under the description column (no flags in front of it).
    const rollingLine = lines.find((l) => l.includes("rolling: replace instances"));
    expect(rollingLine).toBeDefined();
    expect(rollingLine).not.toContain("--strategy");
    expect(rollingLine).toMatch(/^\s+rolling: replace instances/);
  });

  it("emits <br> for line breaks in the generated Markdown table", async () => {
    using _consoleSpy = spyOnConsoleLog();
    await assertDocMatch(baseDocConfig);
  });
});
