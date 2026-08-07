// Exercises the documented "Pattern 3" compatibility surface: augmenting
// GlobalArgs on the "politty" module must merge into the args type that
// defineCommand's run callback receives.
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
    const v: boolean = args.verbose;
    const n: string = args.n;
    return [v, n];
  },
});
