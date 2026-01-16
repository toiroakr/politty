import { defineCommand } from "politty";
import { executionsCommand } from "./executions.js";
import { getCommand } from "./get.js";
import { listCommand } from "./list.js";
import { resumeCommand } from "./resume.js";
import { startCommand } from "./start.js";

/**
 * Manage workflows
 */
export const workflowCommand = defineCommand({
  name: "workflow",
  description: "Manage Tailor Platform workflows",
  subCommands: {
    list: listCommand,
    get: getCommand,
    start: startCommand,
    executions: executionsCommand,
    resume: resumeCommand,
  },
  notes: `Workflows allow you to orchestrate complex business processes.
You can start, monitor, and manage workflow executions.`,
  examples: [
    {
      description: "List all workflows",
      input: "tailor-sdk workflow",
    },
  ],
});
