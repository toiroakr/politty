import { arg, defineCommand } from "politty";
import { z } from "zod/v4";

/**
 * Generate types and files from configuration
 */
export const generateCommand = defineCommand({
  name: "generate",
  description: "Generate types and files from your application configuration",
  args: z.object({
    config: arg(z.string().default("tailor.config.ts"), {
      description: "Path to SDK configuration file",
      alias: "c",
      placeholder: "path",
    }),
    watch: arg(z.boolean().default(false), {
      description: "Watch for changes and regenerate",
      alias: "w",
    }),
  }),
  notes: "This command generates TypeScript types based on your TailorDB schema.",
  examples: [
    {
      description: "Generate types from default config",
      input: "tailor-sdk generate",
    },
    {
      description: "Generate with watch mode",
      input: "tailor-sdk generate --watch",
    },
  ],
  run: (args) => {
    console.log("generate", args);
  },
});
