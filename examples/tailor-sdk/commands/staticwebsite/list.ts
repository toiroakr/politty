import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * List static websites
 */
export const listCommand = defineCommand({
  name: "list",
  description: "List all static websites",
  args: z.object({
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
      description: "List all websites",
      input: "tailor-sdk staticwebsite list",
    },
  ],
  run: (args) => {
    console.log("staticwebsite list", args);
  },
});
