import { defineCommand } from "politty";
import { currentCommand } from "./current.js";
import { listCommand } from "./list.js";
import { patCommand } from "./pat/index.js";
import { switchCommand } from "./switch.js";

/**
 * Manage Tailor Platform users
 */
export const userCommand = defineCommand({
  name: "user",
  description: "Manage Tailor Platform users",
  subCommands: {
    current: currentCommand,
    list: listCommand,
    switch: switchCommand,
    pat: patCommand,
  },
  notes: `User management commands allow you to:
- View the currently logged-in user
- List all authenticated users
- Switch between authenticated accounts
- Manage personal access tokens`,
  examples: [
    {
      description: "List all users",
      input: "tailor-sdk user",
    },
  ],
});
