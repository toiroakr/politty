import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Start a workflow execution
 */
export const startCommand = defineCommand({
  name: "start",
  description: "Start a workflow execution",
  args: z.object({
    name: arg(z.string(), {
      description: "Workflow name",
      positional: true,
      placeholder: "name",
    }),
    machineUser: arg(z.string(), {
      description: "Machine user for authentication",
      placeholder: "user",
    }),
    jsonArgs: arg(z.string().optional(), {
      description: "JSON arguments for the workflow",
      placeholder: "json",
    }),
    wait: arg(z.boolean().default(false), {
      description: "Wait for workflow completion",
    }),
    log: arg(z.boolean().default(false), {
      description: "Stream workflow logs",
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
      description: "Start a workflow",
      input: "tailor-sdk workflow start my-workflow --machine-user bot",
    },
    {
      description: "Start and wait for completion",
      input: "tailor-sdk workflow start my-workflow --machine-user bot --wait",
    },
  ],
  run: (args) => {
    console.log("workflow start", args);
  },
});
