import { assertDocMatch, type GenerateDocConfig } from "politty/docs";
import { command } from "./command.js";

const baseConfig: Omit<GenerateDocConfig, "targetCommands"> = {
  command,
  files: { "tests/migrate/fixtures/spread-base/README.old.md": ["greet"] },
};

await assertDocMatch({
  ...baseConfig,
  targetCommands: ["greet"],
});
