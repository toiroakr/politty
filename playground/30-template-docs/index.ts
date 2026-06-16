/**
 * 30-template-docs - Template-based documentation generation
 *
 * Demonstrates generating a marker-free README.md from README.template.md.
 * The template mixes handwritten markdown with {{politty:...}} placeholders;
 * the generated output contains no politty markers.
 *
 * Usage:
 *   pnpx tsx playground/30-template-docs/index.ts add "Buy milk"
 *   pnpx tsx playground/30-template-docs/index.ts list --done
 *   pnpx tsx playground/30-template-docs/index.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// add subcommand
export const addCommand = defineCommand({
  name: "add",
  description: "Add a new task",
  args: z.object({
    title: arg(z.string(), {
      positional: true,
      description: "Task title",
    }),
    priority: arg(z.enum(["low", "mid", "high"]).default("mid"), {
      alias: "p",
      description: "Task priority",
    }),
  }),
  examples: [
    {
      cmd: '"Buy milk"',
      desc: "Add a task with default priority",
    },
    {
      cmd: '"Ship release" -p high',
      desc: "Add a high-priority task",
    },
  ],
  run: (args) => {
    const message = `Added task: ${args.title} (priority: ${args.priority})`;
    console.log(message);
    return { title: args.title, priority: args.priority };
  },
});

// list subcommand
export const listCommand = defineCommand({
  name: "list",
  description: "List tasks",
  args: z.object({
    done: arg(z.boolean().default(false), {
      alias: "d",
      description: "Include completed tasks",
    }),
  }),
  run: (args) => {
    const scope = args.done ? "all tasks" : "open tasks";
    console.log(`Listing ${scope}`);
    return { done: args.done };
  },
});

// main command
export const command = defineCommand({
  name: "task-cli",
  description: "A tiny task manager CLI",
  subCommands: {
    add: addCommand,
    list: listCommand,
  },
});

if (process.argv[1]?.includes("30-template-docs")) {
  runMain(command, { version: "1.0.0" });
}
