import { z } from "zod";
import { arg, defineCommand } from "../../../../politty/src/index.js";

export const initCommand = defineCommand({
  name: "init",
  description: "Initialize a new project",
  args: z.object({
    name: arg(z.string(), {
      positional: true,
      description: "Project name",
    }),
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "Project template to use",
    }),
  }),
  run: () => {},
});

export const command = defineCommand({
  name: "project-cli",
  description: "Project management CLI",
  subCommands: {
    init: initCommand,
  },
});
