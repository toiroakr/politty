// Must FAIL to typecheck: the GlobalArgs augmentation types args.verbose as
// boolean, so assigning it to string is an error the harness expects. If
// tsgo accepts this file, the positive fixture proves nothing (e.g. args
// collapsed to any).
import { defineCommand } from "politty";
import { z } from "zod";

declare module "politty" {
  interface GlobalArgs {
    verbose: boolean;
  }
}

defineCommand({
  name: "t",
  args: z.object({ n: z.string() }),
  run: (args) => {
    const v: string = args.verbose;
    return v;
  },
});
