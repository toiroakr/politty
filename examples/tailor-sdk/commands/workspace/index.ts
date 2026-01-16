import { defineCommand } from "politty";
import { createCommand } from "./create.js";
import { deleteCommand } from "./delete.js";
import { listCommand } from "./list.js";

/**
 * Manage Tailor Platform workspaces
 */
export const workspaceCommand = defineCommand({
  name: "workspace",
  description: "Manage Tailor Platform workspaces",
  subCommands: {
    create: createCommand,
    list: listCommand,
    delete: deleteCommand,
  },
  notes: `Workspaces are isolated environments for your applications.
Each workspace has its own resources, configurations, and permissions.`,
  examples: [
    {
      description: "List all workspaces",
      input: "tailor-sdk workspace",
    },
  ],
});
