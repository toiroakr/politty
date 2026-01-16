import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * List workspaces
 */
export const listCommand = defineCommand({
  name: "list",
  description: "List all workspaces",
  args: z.object({
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "List all workspaces",
      input: "tailor-sdk workspace list",
    },
  ],
  run: (args) => {
    console.log("workspace list", args);
  },
});
