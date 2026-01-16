import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * List personal access tokens
 */
export const listCommand = defineCommand({
  name: "list",
  description: "List all personal access tokens",
  args: z.object({
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "List all tokens",
      input: "tailor-sdk user pat list",
    },
  ],
  run: (args) => {
    console.log("user pat list", args);
  },
});
