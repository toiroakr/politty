import { assertDocMatch } from "politty/docs";
import { command } from "./command.js";

await assertDocMatch({
  command,
  files: { "tests/migrate/fixtures/inline-array/README.old.md": ["greet"] },
});
