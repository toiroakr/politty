/**
 * 08-cat-command.ts - catコマンド風の例（配列positionalのみ）
 *
 * 実行方法:
 *   pnpx tsx playground/08-cat-command.ts file1.txt
 *   pnpx tsx playground/08-cat-command.ts file1.txt file2.txt file3.txt
 *   pnpx tsx playground/08-cat-command.ts -n a.txt b.txt c.txt
 *   pnpx tsx playground/08-cat-command.ts --help
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

const command = defineCommand({
  name: "cat",
  description: "ファイルの内容を表示する（catコマンド風）",
  args: z.object({
    files: arg(z.array(z.string()), {
      positional: true,
      description: "表示するファイル",
    }),
    number: arg(z.boolean().default(false), {
      alias: "n",
      description: "行番号を表示",
    }),
    showEnds: arg(z.boolean().default(false), {
      alias: "E",
      description: "行末に$を表示",
    }),
  }),
  run: ({ args }) => {
    console.log(`Displaying ${args.files.length} file(s):`);
    for (const file of args.files) {
      console.log(`\n=== ${file} ===`);
      // 実際にはファイルの内容を読み込んで表示
      console.log(`(contents of ${file})`);
      if (args.number) {
        console.log("  (with line numbers)");
      }
      if (args.showEnds) {
        console.log("  (showing line ends)");
      }
    }
  },
});

runMain(command);
