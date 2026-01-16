import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Create a profile
 */
export const createCommand = defineCommand({
  name: "create",
  description: "Create a new profile",
  args: z.object({
    name: arg(z.string(), {
      description: "Profile name",
      alias: "n",
      placeholder: "name",
    }),
    workspaceId: arg(z.string(), {
      description: "Workspace ID to associate with the profile",
      alias: "w",
      placeholder: "id",
    }),
    user: arg(z.string().optional(), {
      description: "User email to associate with the profile",
      alias: "u",
      placeholder: "email",
    }),
    json: arg(z.boolean().default(false), {
      description: "Output in JSON format",
      alias: "j",
    }),
  }),
  examples: [
    {
      description: "Create a profile",
      input: "tailor-sdk profile create -n production -w ws-123",
    },
  ],
  run: (args) => {
    console.log("profile create", args);
  },
});
