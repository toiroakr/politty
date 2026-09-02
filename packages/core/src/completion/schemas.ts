/**
 * Arg schemas for the completion-related hidden/visible subcommands.
 *
 * Split out from `index.ts` so `with-completion-command.ts` can build
 * synchronous `lazy()` metadata for these subcommands (names, descriptions,
 * args — used by help/completion for the parent CLI) without statically
 * pulling in the bash/zsh/fish generators, the dynamic completion engine,
 * or the on-disk install/refresh logic. Those only load when one of these
 * subcommands actually runs.
 */

import { internalArgs, internalField, type InferInternalArgs } from "../adapter/internal-args.js";

/**
 * Schema for the completion command arguments
 */
export const completionArgsSchema = internalArgs({
  shell: internalField.optionalEnum(["bash", "zsh", "fish"], {
    positional: true,
    description: "Shell type (bash, zsh, or fish)",
    placeholder: "SHELL",
  }),
  instructions: internalField.boolean({
    alias: "i",
    description: "Show installation instructions",
  }),
  loader: internalField.boolean({
    description:
      "Print just the rc loader snippet (bash/zsh). Add it to ~/.bashrc or ~/.zshrc; it auto-regenerates the cache when the binary changes.",
  }),
  install: internalField.boolean({
    description:
      "Write the completion script to its on-disk cache (bash/zsh) or autoload location (fish) instead of printing it.",
  }),
  static: internalField.boolean({
    description: "Generate the legacy static completion script with command metadata baked in.",
  }),
  dispatcher: internalField.boolean({
    description: "Generate the runtime dispatcher completion script. This is the default.",
  }),
  worker: internalField.boolean({
    description: "Generate an internal static worker artifact for dispatcher mode.",
  }),
});

export type CompletionArgs = InferInternalArgs<typeof completionArgsSchema>;

export const refreshArgsSchema = internalArgs({
  shell: internalField.enum(["bash", "zsh", "fish"], {
    positional: true,
    description: "Shell to refresh",
    placeholder: "SHELL",
  }),
  target: internalField.optionalString({
    positional: true,
    description: "Existing politty-generated completion file to refresh",
    placeholder: "TARGET",
  }),
  static: internalField.boolean({
    description: "Refresh using the legacy static completion script mode.",
  }),
  worker: internalField.boolean({
    description: "Refresh an internal static worker completion script.",
  }),
});

export type RefreshArgs = InferInternalArgs<typeof refreshArgsSchema>;

export const workerPathArgsSchema = internalArgs({
  shell: internalField.enum(["bash", "zsh", "fish"], {
    positional: true,
    description: "Shell worker to locate",
    placeholder: "SHELL",
  }),
});

export type WorkerPathArgs = InferInternalArgs<typeof workerPathArgsSchema>;
