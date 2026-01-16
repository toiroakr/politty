import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Get workflow details
 */
export const getCommand = defineCommand({
  name: "get",
  description: "Get workflow details",
  args: z.object({
    name: arg(z.string(), {
      description: "Workflow name",
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
      description: "Get workflow details",
      input: "tailor-sdk workflow get my-workflow",
    },
  ],
  run: (args) => {
    console.log("workflow get", args);
  },
});
