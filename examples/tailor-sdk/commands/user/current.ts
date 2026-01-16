import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Show current user information
 */
export const currentCommand = defineCommand({
  name: "current",
  description: "Display the currently logged-in user",
  args: z.object({
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Show current user",
      input: "tailor-sdk user current",
    },
  ],
  run: (args) => {
    console.log("user current", args);
  },
});
