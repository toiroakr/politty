import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Get static website details
 */
export const getCommand = defineCommand({
  name: "get",
  description: "Get static website details",
  args: z.object({
    name: arg(z.string(), {
      description: "Website name",
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
      description: "Get website details",
      input: "tailor-sdk staticwebsite get my-site",
    },
  ],
  run: (args) => {
    console.log("staticwebsite get", args);
  },
});
