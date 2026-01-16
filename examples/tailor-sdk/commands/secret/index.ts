import { defineCommand } from "politty";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { listCommand } from "./list.js";
import { updateCommand } from "./update.js";
import { vaultCommand } from "./vault/index.js";

/**
 * Manage secrets
 */
export const secretCommand = defineCommand({
  name: "secret",
  description: "Manage secrets and vaults",
  subCommands: {
    vault: vaultCommand,
    create: createCommand,
    list: listCommand,
    update: updateCommand,
    delete: deleteCommand,
  },
  notes: `Secrets are securely stored key-value pairs.
Secrets are organized in vaults within a workspace.`,
  examples: [
    {
      description: "Manage vaults",
      input: "tailor-sdk secret vault",
    },
  ],
});
