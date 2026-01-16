import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Create a secret
 */
export const createCommand = defineCommand({
  name: "create",
  description: "Create a new secret",
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
      description: "Secret value",
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
      description: "Create a secret",
      input: "tailor-sdk secret create -V my-vault -n API_KEY -v secret123",
    },
  ],
  run: (args) => {
    console.log("secret create", args);
  },
});
