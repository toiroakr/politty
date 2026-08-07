// Must FAIL to typecheck: the GlobalArgs augmentation types args.verbose as
// boolean, so assigning it to string is an error the harness expects. If
// tsgo accepts this file, the positive fixture proves nothing (e.g. args
// collapsed to any).
import { defineCommand } from "@politty/valibot";
import * as v from "valibot";

declare module "@politty/valibot" {
  interface GlobalArgs {
    verbose: boolean;
  }
}

defineCommand({
  name: "t",
  args: v.object({ n: v.string() }),
  run: (args) => {
    const verbose: string = args.verbose;
    return verbose;
  },
});
