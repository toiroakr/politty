import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Create a secret vault
 */
export const createCommand = defineCommand({
  name: "create",
  description: "Create a new secret vault",
  args: z.object({
    name: arg(z.string(), {
      description: "Vault name",
      positional: true,
      placeholder: "name",
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
      description: "Create a vault",
      input: "tailor-sdk secret vault create my-vault",
    },
  ],
  run: (args) => {
    console.log("secret vault create", args);
  },
});
