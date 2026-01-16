import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Initialize a new Tailor Platform project
 */
export const initCommand = defineCommand({
  name: "init",
  description: "Initialize a new Tailor Platform project",
  args: z.object({
    name: arg(z.string().optional(), {
      description: "Project name",
      positional: true,
      placeholder: "name",
    }),
    template: arg(z.string().optional(), {
      description: "Project template to use",
      alias: "t",
      placeholder: "template",
    }),
  }),
  notes: `Available templates:
  - hello-world (default)
  - inventory-management
  - testing
  - multi-application`,
  examples: [
    {
      description: "Create a new project with default template",
      input: "tailor-sdk init my-app",
    },
    {
      description: "Create a project with a specific template",
      input: "tailor-sdk init my-app --template inventory-management",
    },
  ],
  run: (args) => {
    console.log("init", args);
  },
});
