import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * List workflow executions
 */
export const executionsCommand = defineCommand({
  name: "executions",
  description: "List and manage workflow executions",
  args: z.object({
    filterWorkflow: arg(z.string().optional(), {
      description: "Filter by workflow name",
      placeholder: "name",
    }),
    filterStatus: arg(z.enum(["PENDING", "RUNNING", "SUCCESS", "FAILED"]).optional(), {
      description: "Filter by execution status",
      placeholder: "status",
    }),
    wait: arg(z.boolean().default(false), {
      description: "Wait for executions to complete",
    }),
    log: arg(z.boolean().default(false), {
      description: "Stream execution logs",
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
      description: "List all executions",
      input: "tailor-sdk workflow executions",
    },
    {
      description: "List running executions",
      input: "tailor-sdk workflow executions --filter-status RUNNING",
    },
  ],
  run: (args) => {
    console.log("workflow executions", args);
  },
});
