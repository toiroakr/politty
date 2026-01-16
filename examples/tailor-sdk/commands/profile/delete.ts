import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Delete a profile
 */
export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a profile",
  args: z.object({
    name: arg(z.string(), {
      description: "Profile name to delete",
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
      description: "Delete a profile",
      input: "tailor-sdk profile delete production",
    },
  ],
  run: (args) => {
    console.log("profile delete", args);
  },
});
