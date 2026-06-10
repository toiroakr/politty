import { generateDoc } from "politty/docs";
import { command, globalSchema } from "./command.js";

await generateDoc({
  command,
  path: "tests/migrate/fixtures/path-globalargs/CLI.old.md",
  globalArgs: globalSchema,
});
