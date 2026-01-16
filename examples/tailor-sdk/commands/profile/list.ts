import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * List profiles
 */
export const listCommand = defineCommand({
  name: "list",
  description: "List all profiles",
  args: z.object({
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "List all profiles",
      input: "tailor-sdk profile list",
    },
  ],
  run: (args) => {
    console.log("profile list", args);
  },
});
