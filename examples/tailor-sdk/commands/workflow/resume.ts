import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Resume a paused workflow
 */
export const resumeCommand = defineCommand({
  name: "resume",
  description: "Resume a paused workflow execution",
  args: z.object({
    executionId: arg(z.string(), {
      description: "Execution ID to resume",
      positional: true,
      placeholder: "id",
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
      description: "Resume a workflow",
      input: "tailor-sdk workflow resume exec-123",
    },
    {
      description: "Resume and wait",
      input: "tailor-sdk workflow resume exec-123 --wait",
    },
  ],
  run: (args) => {
    console.log("workflow resume", args);
  },
});
