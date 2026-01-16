import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Delete a personal access token
 */
export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a personal access token",
  args: z.object({
    name: arg(z.string(), {
      description: "Token name to delete",
      positional: true,
      placeholder: "name",
    }),
    yes: arg(z.boolean().default(false), {
      description: "Skip confirmation prompts",
      alias: "y",
    }),
  }),
  examples: [
    {
      description: "Delete a token",
      input: "tailor-sdk user pat delete my-token",
    },
    {
      description: "Delete without confirmation",
      input: "tailor-sdk user pat delete my-token -y",
    },
  ],
  run: (args) => {
    console.log("user pat delete", args);
  },
});
