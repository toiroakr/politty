/**
 * 07-gcc-command.ts - gccコマンド風の例（配列positional引数）
 *
 * 実行方法:
 *   pnpx tsx playground/07-gcc-command.ts -o app main.c
 *   pnpx tsx playground/07-gcc-command.ts -o myprogram main.c util.c lib.c
 *   pnpx tsx playground/07-gcc-command.ts --output build/app src/a.c src/b.c src/c.c
 *   pnpx tsx playground/07-gcc-command.ts --help
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

const command = defineCommand({
  name: "gcc",
  description: "Cコンパイラ（gccコマンド風）",
  args: z.object({
    output: arg(z.string(), {
      alias: "o",
      description: "出力ファイル名",
    }),
    optimize: arg(z.boolean().default(false), {
      alias: "O",
      description: "最適化を有効にする",
    }),
    sources: arg(z.array(z.string()), {
      positional: true,
      description: "ソースファイル",
    }),
  }),
  run: (args) => {
    console.log("Compiling:");
    console.log(`  Sources: ${args.sources.join(", ")}`);
    console.log(`  Output: ${args.output}`);
    if (args.optimize) {
      console.log("  Optimization: enabled");
    }
  },
});

runMain(command);
