import { internalArgs, internalField, type InferInternalArgs } from "./adapter/internal-args.js";
import { formatShimPath } from "./compile-cache-shim.js";
import { defineCommand } from "./core/command.js";
import { runMain } from "./core/runner.js";
import { generateBundledCompletionWorker, generateCompileCacheShim } from "./index.js";

const generateWorkerArgsSchema = internalArgs({
  bin: internalField.string({
    description: "CLI binary or built JS entry file to invoke",
    placeholder: "PATH",
  }),
  program: internalField.string({
    description: "Program name embedded in worker metadata",
    placeholder: "NAME",
  }),
  shell: internalField.enum(["bash", "zsh", "fish"], {
    description: "Shell worker to generate",
    placeholder: "SHELL",
  }),
  out: internalField.optionalString({
    description: "Output worker path (defaults to dist/completion/<shell>-worker.<ext>)",
    placeholder: "PATH",
  }),
  verify: internalField.boolean({
    description: "Verify __completion-worker-path resolves to the generated worker",
  }),
});

type GenerateWorkerArgs = InferInternalArgs<typeof generateWorkerArgsSchema>;

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

const generateShimArgsSchema = internalArgs({
  entry: internalField.optionalStringArray({
    description:
      "Module specifier the shim imports, relative to the shim file; repeatable, one per bin/--out (defaults to ./cli.js, ./cli.mjs, ./index.js, or ./index.mjs next to each shim)",
    placeholder: "SPECIFIER",
  }),
  out: internalField.optionalStringArray({
    description:
      "Output path for the generated shim; repeatable, one per --entry (defaults to the bin paths in package.json)",
    placeholder: "PATH",
  }),
  program: internalField.optionalString({
    description:
      "Program name for the cache directory, applied to all shims (defaults per shim to its bin name)",
    placeholder: "NAME",
  }),
});

type GenerateShimArgs = InferInternalArgs<typeof generateShimArgsSchema>;

const generateShimCommand = defineCommand({
  name: "generate-shim",
  description: "Generate a compile-cache bin shim that loads the real CLI via dynamic import",
  args: generateShimArgsSchema,
  run(args: GenerateShimArgs) {
    const cwd = process.cwd();
    const results = generateCompileCacheShim({
      ...(args.entry !== undefined && { entry: args.entry }),
      ...(args.out !== undefined && { out: args.out }),
      ...(args.program !== undefined && { program: args.program }),
      cwd,
    });
    for (const result of results) {
      console.log(
        `Generated compile-cache shim: ${formatShimPath(result.outputPath, cwd)} (program: ${result.program}, entry: ${result.entry})`,
      );
    }
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
