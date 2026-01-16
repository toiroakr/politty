import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Delete a workspace
 */
export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a workspace",
  args: z.object({
    name: arg(z.string(), {
      description: "Workspace name to delete",
      positional: true,
      placeholder: "name",
    }),
    yes: arg(z.boolean().default(false), {
      description: "Skip confirmation prompts",
      alias: "y",
    }),
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Delete a workspace",
      input: "tailor-sdk workspace delete my-workspace",
    },
    {
      description: "Delete without confirmation",
      input: "tailor-sdk workspace delete my-workspace -y",
    },
  ],
  run: (args) => {
    console.log("workspace delete", args);
  },
});
