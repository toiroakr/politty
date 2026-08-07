// Exercises the documented "Pattern 3" surface on the valibot package:
// augmenting GlobalArgs on the "@politty/valibot" module must merge into the
// args type that defineCommand's run callback receives. The valibot entry
// re-exports core in a single hop (the politty alias takes two), so this is
// checked separately from the alias fixture.
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
    const verbose: boolean = args.verbose;
    const n: string = args.n;
    return [verbose, n];
  },
});
