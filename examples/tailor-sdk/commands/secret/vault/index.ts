import { defineCommand } from "politty";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { listCommand } from "./list.js";

/**
 * Manage secret vaults
 */
export const vaultCommand = defineCommand({
  name: "vault",
  description: "Manage secret vaults",
  subCommands: {
    create: createCommand,
    list: listCommand,
    delete: deleteCommand,
  },
  notes: "Vaults are containers for organizing secrets within a workspace.",
  examples: [
    {
      description: "List all vaults",
      input: "tailor-sdk secret vault",
    },
  ],
});
