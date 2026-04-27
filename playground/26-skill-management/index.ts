/**
 * playground/26-skill-management/index.ts - Skill management with withSkillCommand
 *
 * How to run:
 *   pnpx tsx playground/26-skill-management/index.ts skills list
 *   pnpx tsx playground/26-skill-management/index.ts skills list --json
 *   pnpx tsx playground/26-skill-management/index.ts skills --help
 */

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "../../src/index.js";
import { withSkillCommand } from "../../src/skill/index.js";

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "skills");

const cli = withSkillCommand(
  defineCommand({
    name: "my-agent",
    description: "Example agent CLI with skill management",
    run: () => {
      console.log("Use 'my-agent skills --help' to manage skills.");
    },
  }),
  { sourceDir, package: "playground-agent" },
);

runMain(cli, { version: "0.1.0" });
