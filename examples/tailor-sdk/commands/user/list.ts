import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * List all authenticated users
 */
export const listCommand = defineCommand({
  name: "list",
  description: "List all authenticated users",
  args: z.object({
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "List all users",
      input: "tailor-sdk user list",
    },
  ],
  run: (args) => {
    console.log("user list", args);
  },
});
