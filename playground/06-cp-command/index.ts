/**
 * 06-cp-command.ts - cpコマンド風の例（複数positional引数）
 *
 * 実行方法:
 *   pnpx tsx playground/06-cp-command.ts source.txt dest.txt
 *   pnpx tsx playground/06-cp-command.ts /path/from /path/to -r
 *   pnpx tsx playground/06-cp-command.ts file1.txt file2.txt --recursive
 *   pnpx tsx playground/06-cp-command.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "cp",
  description: "ファイルをコピーする（cpコマンド風）",
  args: z.object({
    source: arg(z.string(), {
      positional: true,
      description: "コピー元ファイル",
    }),
    destination: arg(z.string(), {
      positional: true,
      description: "コピー先ファイル",
    }),
    recursive: arg(z.boolean().default(false), {
      alias: "r",
      description: "ディレクトリを再帰的にコピー",
    }),
    force: arg(z.boolean().default(false), {
      alias: "f",
      description: "上書き確認をスキップ",
    }),
  }),
  run: (args) => {
    console.log(`Copying: ${args.source} -> ${args.destination}`);
    if (args.recursive) {
      console.log("  (recursive mode)");
    }
    if (args.force) {
      console.log("  (force mode)");
    }
  },
});

if (process.argv[1]?.includes("06-cp-command")) {
  runMain(command);
}
