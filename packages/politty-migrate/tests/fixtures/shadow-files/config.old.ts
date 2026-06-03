import type { FileConfig } from "politty/docs";
import { assertDocMatch } from "politty/docs";
import { mainCommand } from "./index.js";

// A helper declares a NESTED `const files` that is unrelated. It must NOT
// shadow the real TOP-LEVEL `const files` whose entries carry the removed
// FileConfig keys. The resolver previously returned the nested object and left
// the real `const files` (with `title:`) untouched and with NO TODO — the
// original silent-miss bug reincarnated.
function collectFiles() {
  const files = { unrelated: 1 };
  return files;
}

const files: Record<string, FileConfig> = {
  "docs/cli/application.md": {
    title: "Application Commands",
    description: "Commands for managing applications.",
    commands: ["init", "deploy"],
  },
};

await assertDocMatch({
  command: mainCommand,
  files,
});
