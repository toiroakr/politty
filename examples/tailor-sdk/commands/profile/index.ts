import { defineCommand } from "politty";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { listCommand } from "./list.js";
import { updateCommand } from "./update.js";

/**
 * Manage profiles
 */
export const profileCommand = defineCommand({
  name: "profile",
  description: "Manage profiles for workspace and user configurations",
  subCommands: {
    create: createCommand,
    list: listCommand,
    update: updateCommand,
    delete: deleteCommand,
  },
  notes: `Profiles store workspace and user configurations for easy switching.
Use profiles to quickly switch between different environments.`,
  examples: [
    {
      description: "List all profiles",
      input: "tailor-sdk profile",
    },
  ],
});
