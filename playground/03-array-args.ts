/**
 * 03-array-args.ts - 配列引数の例
 *
 * 実行方法:
 *   pnpx tsx playground/03-array-args.ts --files a.txt --files b.txt -f c.txt
 *   pnpx tsx playground/03-array-args.ts -f one.txt -f two.txt -f three.txt
 *   pnpx tsx playground/03-array-args.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../src/index.js";

export const command = defineCommand({
  name: "process-files",
  description: "複数ファイルを処理する",
  args: z.object({
    files: arg(z.array(z.string()), {
      alias: "f",
      description: "処理するファイル（複数指定可）",
    }),
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "詳細出力",
    }),
  }),
  run: (args) => {
    console.log(`Processing ${args.files.length} files:`);
    for (const file of args.files) {
      if (args.verbose) {
        console.log(`  - Processing: ${file}`);
      } else {
        console.log(`  - ${file}`);
      }
    }
  },
});

if (process.argv[1]?.includes("03-array-args")) {
  runMain(command);
}
