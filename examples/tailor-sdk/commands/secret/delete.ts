import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Delete a secret
 */
export const deleteCommand = defineCommand({
  name: "delete",
  description: "Delete a secret",
  args: z.object({
    vault: arg(z.string(), {
      description: "Vault name",
      alias: "V",
      placeholder: "vault",
    }),
    name: arg(z.string(), {
      description: "Secret name to delete",
      alias: "n",
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
      description: "Delete a secret",
      input: "tailor-sdk secret delete -V my-vault -n API_KEY",
    },
  ],
  run: (args) => {
    console.log("secret delete", args);
  },
});
