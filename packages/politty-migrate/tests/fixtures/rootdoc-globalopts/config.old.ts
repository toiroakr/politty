import { assertDocMatch } from "politty/docs";
import { command, commonOptions } from "./command.js";

await assertDocMatch({
  command,
  rootInfo: {
    title: "project-cli",
    description: "Project management CLI demonstrating docs markers",
  },
  rootDoc: {
    path: "tests/migrate/fixtures/rootdoc-globalopts/REFERENCE.old.md",
    globalOptions: commonOptions,
  },
  files: {
    "tests/migrate/fixtures/rootdoc-globalopts/README.old.md": ["init"],
  },
});
