import { defineCommand } from "@politty/loculus";
import * as v from "../../../../packages/loculus/node_modules/loculus/dist/index.js";

declare module "@politty/loculus" {
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
