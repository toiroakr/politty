/**
 * Arg schema for the `__complete` command.
 *
 * Split out from `complete-command.ts` so `with-completion-command.ts` can
 * build synchronous `lazy()` metadata for `__complete` without statically
 * pulling in the dynamic completion engine (`candidate-generator.ts`,
 * `context-parser.ts`), which only loads once `__complete` actually runs.
 */

import {
  internalArgs,
  internalField,
  type InferInternalArgs,
} from "../../adapter/internal-args.js";

export const completeArgsSchema = internalArgs({
  shell: internalField.enum(["bash", "zsh", "fish"], {
    description: "Target shell for output formatting",
  }),
  // The arguments to complete are passed after --
  args: internalField.stringArray({
    positional: true,
    description: "Arguments to complete",
  }),
});

export type CompleteArgs = InferInternalArgs<typeof completeArgsSchema>;
