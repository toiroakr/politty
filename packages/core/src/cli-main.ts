// Imported from the defining modules rather than from `./index.js`: the
// package entry re-exports `runPolittyCli` (the `politty` alias reaches its
// own CLI through it), and going through the entry would make that a cycle.
// The completion-worker generator is deliberately absent here — it is loaded
// inside `generate-worker`'s handler so this entry, which every politty
// package's bin reaches, does not pull the completion machinery into its
// static graph.
import { internalArgs, internalField, type InferInternalArgs } from "./adapter/internal-args.js";
import { createCompileCacheShimGenerator, formatShimPath } from "./compile-cache-shim.js";
import { defineCommand } from "./core/command.js";
import { runMain } from "./core/runner.js";

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
    // Loaded here rather than at module scope: see the import note at the top.
    const { generateBundledCompletionWorker } = await import("./index.js");
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
  compileCacheSpecifier: internalField.optionalString({
    description:
      "Module specifier the shim imports enableCompileCache from (defaults to the compile-cache subpath of the politty package running this command)",
    placeholder: "SPECIFIER",
  }),
});

type GenerateShimArgs = InferInternalArgs<typeof generateShimArgsSchema>;

/**
 * Run politty's own development CLI (`generate-shim`, `generate-worker`).
 *
 * `ownerPackage` is the npm name of the politty package providing the `politty`
 * bin that invoked this — `@politty/zod`, `@politty/valibot`, or `politty`. It
 * is threaded through to {@link createCompileCacheShimGenerator} so a generated
 * shim imports the cache helper from the package the user actually installed,
 * which is the one guaranteed to resolve from their own package.
 *
 * Never returns: it exits the process, like `runMain`.
 */
export function runPolittyCli(ownerPackage: string): Promise<never> {
  const generateCompileCacheShim = createCompileCacheShimGenerator(ownerPackage);

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
        ...(args.compileCacheSpecifier !== undefined && {
          compileCacheSpecifier: args.compileCacheSpecifier,
        }),
        cwd,
      });
      for (const result of results) {
        console.log(
          `Generated compile-cache shim: ${formatShimPath(result.outputPath, cwd)} (program: ${result.program}, entry: ${result.entry}, compile-cache: ${result.compileCacheSpecifier})`,
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

  return runMain(cli).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
