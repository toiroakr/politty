import { defineCommand } from "politty";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { listCommand } from "./list.js";
import { updateCommand } from "./update.js";

/**
 * Manage personal access tokens
 */
export const patCommand = defineCommand({
  name: "pat",
  description: "Manage personal access tokens",
  subCommands: {
    create: createCommand,
    delete: deleteCommand,
    list: listCommand,
    update: updateCommand,
  },
  notes: `Personal access tokens (PATs) allow programmatic access to Tailor Platform APIs.
Use these tokens for CI/CD pipelines, scripts, and integrations.`,
  examples: [
    {
      description: "List all tokens",
      input: "tailor-sdk user pat",
    },
  ],
});
