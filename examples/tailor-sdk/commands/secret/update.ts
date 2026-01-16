import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Update a secret
 */
export const updateCommand = defineCommand({
  name: "update",
  description: "Update an existing secret",
  args: z.object({
    vault: arg(z.string(), {
      description: "Vault name",
      alias: "V",
      placeholder: "vault",
    }),
    name: arg(z.string(), {
      description: "Secret name",
      alias: "n",
      placeholder: "name",
    }),
    value: arg(z.string(), {
      description: "New secret value",
      alias: "v",
      placeholder: "value",
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
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Update a secret",
      input: "tailor-sdk secret update -V my-vault -n API_KEY -v newsecret",
    },
  ],
  run: (args) => {
    console.log("secret update", args);
  },
});
