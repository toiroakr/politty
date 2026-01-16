import { defineCommand } from "politty";
import { getCommand } from "./get.js";
import { listCommand } from "./list.js";

/**
 * Manage OAuth2 clients
 */
export const oauth2clientCommand = defineCommand({
  name: "oauth2client",
  description: "Manage OAuth2 clients for authentication",
  subCommands: {
    list: listCommand,
    get: getCommand,
  },
  notes: "OAuth2 clients enable OAuth2 authentication flows for your applications.",
  examples: [
    {
      description: "List OAuth2 clients",
      input: "tailor-sdk oauth2client",
    },
  ],
});
