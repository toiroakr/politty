import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Generate TypeScript types
 */
export const typeGeneratorCommand = defineCommand({
  name: "type-generator",
  description: "Generate TypeScript types from your schema",
  args: z.object({
    config: arg(z.string().default("tailor.config.ts"), {
      description: "Path to SDK configuration file",
      alias: "c",
      placeholder: "path",
    }),
    output: arg(z.string().optional(), {
      description: "Output directory for generated types",
      alias: "o",
      placeholder: "dir",
    }),
  }),
  examples: [
    {
      description: "Generate types",
      input: "tailor-sdk type-generator",
    },
    {
      description: "Generate types to specific directory",
      input: "tailor-sdk type-generator -o ./types",
    },
  ],
  run: (args) => {
    console.log("type-generator", args);
  },
});
