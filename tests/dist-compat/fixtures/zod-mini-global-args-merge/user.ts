// Exercises the documented "Pattern 3" surface on the zod-mini package:
// augmenting GlobalArgs on the "@politty/zod-mini" module must merge into
// the args type that defineCommand's run callback receives. The zod-mini
// entry re-exports core in a single hop (the politty alias takes two), so
// this is checked separately from the alias fixture.
import { defineCommand } from "@politty/zod-mini";
import * as z from "zod/mini";

declare module "@politty/zod-mini" {
  interface GlobalArgs {
    verbose: boolean;
  }
}

defineCommand({
  name: "t",
  args: z.object({ n: z.string() }),
  run: (args) => {
    const verbose: boolean = args.verbose;
    const n: string = args.n;
    return [verbose, n];
  },
});
