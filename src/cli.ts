#!/usr/bin/env node

import { arg } from "./core/arg-registry.js";
import { defineCommand } from "./core/command.js";
import { type InferInternal, s } from "./core/internal-schema.js";
import { runMain } from "./core/runner.js";
import { generateBundledCompletionWorker } from "./index.js";

const generateWorkerArgsSchema = s.object({
  bin: arg(s.string(), {
    description: "CLI binary or built JS entry file to invoke",
    placeholder: "PATH",
  }),
  program: arg(s.string(), {
    description: "Program name embedded in worker metadata",
    placeholder: "NAME",
  }),
  shell: arg(s.enum(["bash", "zsh", "fish"]), {
    description: "Shell worker to generate",
    placeholder: "SHELL",
  }),
  out: arg(s.string().optional(), {
    description: "Output worker path (defaults to dist/completion/<shell>-worker.<ext>)",
    placeholder: "PATH",
  }),
  verify: arg(s.boolean().default(false), {
    description: "Verify __completion-worker-path resolves to the generated worker",
  }),
});

type GenerateWorkerArgs = InferInternal<typeof generateWorkerArgsSchema>;

const generateWorkerCommand = defineCommand({
  name: "generate-worker",
  description: "Generate and verify a bundled shell completion worker",
  args: generateWorkerArgsSchema,
  async run(args: GenerateWorkerArgs) {
    await generateBundledCompletionWorker({
      bin: args.bin,
      programName: args.program,
      shell: args.shell,
      ...(args.out !== undefined && { outputPath: args.out }),
      verify: args.verify,
    });
  },
});

const cli = defineCommand({
  name: "politty",
  description: "politty development utilities",
  subCommands: {
    "generate-worker": generateWorkerCommand,
  },
});

runMain(cli).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
