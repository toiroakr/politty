import { defineCommand } from "politty";
import { truncateCommand } from "./truncate.js";

/**
 * Manage TailorDB
 */
export const tailordbCommand = defineCommand({
  name: "tailordb",
  description: "Manage TailorDB operations",
  subCommands: {
    truncate: truncateCommand,
  },
  notes: "TailorDB is the database service for your Tailor Platform applications.",
  examples: [
    {
      description: "Truncate tables",
      input: "tailor-sdk tailordb truncate --all",
    },
  ],
});
