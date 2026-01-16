import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Delete a secret vault
 */
export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a secret vault",
  args: z.object({
    name: arg(z.string(), {
      description: "Vault name to delete",
      positional: true,
      placeholder: "name",
    }),
    yes: arg(z.boolean().default(false), {
      description: "Skip confirmation prompts",
      alias: "y",
    }),
    workspaceId: arg(z.string().optional(), {
      description: "Target workspace ID",
      alias: "w",
      placeholder: "id",
      env: "TAILOR_WORKSPACE_ID",
    }),
    profile: arg(z.string().optional(), {
      description: "Profile to use",
      alias: "p",
      placeholder: "name",
    }),
  }),
  examples: [
    {
      description: "Delete a vault",
      input: "tailor-sdk secret vault delete my-vault",
    },
  ],
  run: (args) => {
    console.log("secret vault delete", args);
  },
});
