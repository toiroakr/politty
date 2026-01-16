import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Update a profile
 */
export const updateCommand = defineCommand({
  name: "update",
  description: "Update an existing profile",
  args: z.object({
    name: arg(z.string(), {
      description: "Profile name to update",
      positional: true,
      placeholder: "name",
    }),
    workspaceId: arg(z.string().optional(), {
      description: "New workspace ID",
      alias: "w",
      placeholder: "id",
    }),
    user: arg(z.string().optional(), {
      description: "New user email",
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
      description: "Update a profile workspace",
      input: "tailor-sdk profile update production -w ws-456",
    },
  ],
  run: (args) => {
    console.log("profile update", args);
  },
});
