import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * List secrets
 */
export const listCommand = defineCommand({
  name: "list",
  description: "List all secrets in a vault",
  args: z.object({
    vault: arg(z.string(), {
      description: "Vault name",
      alias: "V",
      placeholder: "vault",
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
      description: "List secrets in a vault",
      input: "tailor-sdk secret list -V my-vault",
    },
  ],
  run: (args) => {
    console.log("secret list", args);
  },
});
