import { defineCommand } from "politty";
import { listCommand } from "./list.js";
import { tokenCommand } from "./token.js";

/**
 * Manage machine users
 */
export const machineuserCommand = defineCommand({
  name: "machineuser",
  description: "Manage machine users for authentication",
  subCommands: {
    list: listCommand,
    token: tokenCommand,
  },
  notes: "Machine users are service accounts for programmatic access.",
  examples: [
    {
      description: "List machine users",
      input: "tailor-sdk machineuser",
    },
  ],
});
