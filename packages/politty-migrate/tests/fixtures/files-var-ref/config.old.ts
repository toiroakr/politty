import type { FileConfig } from "politty/docs";
import { assertDocMatch, createCommandRenderer } from "politty/docs";
import { z } from "zod";
import { mainCommand } from "./index.js";

const defaultRender = createCommandRenderer({ headingLevel: 1 });

// A same-file `const files` referenced BY VARIABLE at the call site, whose
// entries use the REMOVED FileConfig keys title/description/render. This mirrors
// the real repo shape that exposed the silent-miss bug.
const files: Record<string, FileConfig> = {
  "docs/cli/application.md": {
    title: "Application Commands",
    description: "Commands for managing applications (work with `tailor.config.ts`).",
    commands: ["init", "deploy"],
    render: defaultRender,
  },
  "docs/cli/query.md": {
    title: "Query Commands",
    description: "Run ad-hoc SQL/GraphQL queries.",
    commands: ["query"],
    render: createCommandRenderer({ headingLevel: 1 }),
  },
  "docs/cli/custom.md": {
    title: "Custom Commands",
    commands: ["custom"],
    render: makeFancyRenderer(),
  },
};

const targetCommands = Object.values(files).flatMap((c) => c.commands);

await assertDocMatch({
  command: mainCommand,
  files,
  targetCommands,
  globalArgs: z.object({}),
  rootDoc: { path: "docs/cli-reference.md" },
});
