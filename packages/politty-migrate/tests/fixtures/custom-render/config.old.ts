import { assertDocMatch } from "politty/docs";
import { command } from "./command.js";
import { customRenderer } from "./renderer.js";

await assertDocMatch({
  command,
  files: {
    "tests/migrate/fixtures/custom-render/README.old.md": {
      title: "Build Docs",
      description: "How to build.",
      commands: ["build"],
      render: customRenderer,
    },
  },
});
