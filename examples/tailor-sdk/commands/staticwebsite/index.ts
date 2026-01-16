import { defineCommand } from "politty";
import { deployCommand } from "./deploy.js";
import { getCommand } from "./get.js";
import { listCommand } from "./list.js";

/**
 * Manage static websites
 */
export const staticwebsiteCommand = defineCommand({
  name: "staticwebsite",
  description: "Manage static websites",
  subCommands: {
    deploy: deployCommand,
    list: listCommand,
    get: getCommand,
  },
  notes: "Deploy and manage static websites on Tailor Platform.",
  examples: [
    {
      description: "List all websites",
      input: "tailor-sdk staticwebsite",
    },
  ],
});
