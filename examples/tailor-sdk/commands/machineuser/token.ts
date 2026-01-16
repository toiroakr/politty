import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Get machine user token
 */
export const tokenCommand = defineCommand({
  name: "token",
  description: "Get a token for a machine user",
  args: z.object({
    name: arg(z.string(), {
      description: "Machine user name",
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
      description: "Get a machine user token",
      input: "tailor-sdk machineuser token my-bot",
    },
  ],
  run: (args) => {
    console.log("machineuser token", args);
  },
});
