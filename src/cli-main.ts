import { z } from "zod";
import { arg } from "./core/arg-registry.js";
import { defineCommand } from "./core/command.js";
import { runMain } from "./core/runner.js";
import {
  formatShimPath,
  generateBundledCompletionWorker,
  generateCompileCacheShim,
} from "./index.js";

const generateWorkerArgsSchema = z.object({
  bin: arg(z.string(), {
    description: "CLI binary or built JS entry file to invoke",
    placeholder: "PATH",
  }),
  program: arg(z.string(), {
    description: "Program name embedded in worker metadata",
    placeholder: "NAME",
  }),
  shell: arg(z.enum(["bash", "zsh", "fish"]), {
    description: "Shell worker to generate",
    placeholder: "SHELL",
  }),
  out: arg(z.string().optional(), {
    description: "Output worker path (defaults to dist/completion/<shell>-worker.<ext>)",
    placeholder: "PATH",
  }),
  verify: arg(z.boolean().default(false), {
    description: "Verify __completion-worker-path resolves to the generated worker",
  }),
});

type GenerateWorkerArgs = z.infer<typeof generateWorkerArgsSchema>;

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

const generateShimArgsSchema = z.object({
  entry: arg(z.string().optional(), {
    description:
      "Module specifier the shim imports, relative to the shim file (defaults to ./cli.js, ./cli.mjs, ./index.js, or ./index.mjs next to the shim)",
    placeholder: "SPECIFIER",
  }),
  out: arg(z.string().optional(), {
    description:
      "Output path for the generated shim (defaults to the first bin path in package.json)",
    placeholder: "PATH",
  }),
  program: arg(z.string().optional(), {
    description:
      "Program name for the cache directory (defaults to the first bin name or package name in package.json)",
    placeholder: "NAME",
  }),
});

type GenerateShimArgs = z.infer<typeof generateShimArgsSchema>;

const generateShimCommand = defineCommand({
  name: "generate-shim",
  description: "Generate a compile-cache bin shim that loads the real CLI via dynamic import",
  args: generateShimArgsSchema,
  run(args: GenerateShimArgs) {
    const cwd = process.cwd();
    const result = generateCompileCacheShim({
      ...(args.entry !== undefined && { entry: args.entry }),
      ...(args.out !== undefined && { out: args.out }),
      ...(args.program !== undefined && { program: args.program }),
      cwd,
    });
    console.log(
      `Generated compile-cache shim: ${formatShimPath(result.outputPath, cwd)} (program: ${result.program}, entry: ${result.entry})`,
    );
  },
});

const cli = defineCommand({
  name: "politty",
  description: "politty development utilities",
  subCommands: {
    "generate-shim": generateShimCommand,
    "generate-worker": generateWorkerCommand,
  },
});

runMain(cli).catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
