/**
 * 14-transform-refine.ts - transform/refineの例
 *
 * 実行方法:
 *   pnpx tsx playground/14-transform-refine.ts hello --tags "a,b,c"
 *   pnpx tsx playground/14-transform-refine.ts WORLD -t "tag1,tag2"
 *   pnpx tsx playground/14-transform-refine.ts input.txt output.txt   # 同じファイル名はエラー
 *   pnpx tsx playground/14-transform-refine.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// transformの例
export const transformCommand = defineCommand({
  name: "transform-example",
  description: "transformを使った変換の例",
  args: z.object({
    // 大文字に変換
    name: arg(
      z.string().transform((s) => s.toUpperCase()),
      {
        positional: true,
        description: "名前（大文字に変換される）",
      },
    ),
    // カンマ区切りを配列に変換
    tags: arg(
      z.string().transform((s) => s.split(",").map((t) => t.trim())),
      {
        alias: "t",
        description: "カンマ区切りのタグ",
      },
    ),
  }),
  run: (args) => {
    console.log("Transform example:");
    console.log(`  Name: ${args.name} (uppercased)`);
    console.log(`  Tags: ${JSON.stringify(args.tags)} (split from comma-separated)`);
  },
});

// refineの例
export const refineCommand = defineCommand({
  name: "refine-example",
  description: "refineを使ったカスタムバリデーションの例",
  args: z
    .object({
      input: arg(z.string(), {
        positional: true,
        description: "入力ファイル",
      }),
      output: arg(z.string(), {
        positional: true,
        description: "出力ファイル",
      }),
    })
    .refine((data) => data.input !== data.output, {
      message: "入力と出力は異なるファイルを指定してください",
    }),
  run: (args) => {
    console.log("Refine example:");
    console.log(`  Input: ${args.input}`);
    console.log(`  Output: ${args.output}`);
    console.log("  (validation passed: input !== output)");
  },
});

// コマンド選択
export const cli = defineCommand({
  name: "validation-demo",
  description: "transform/refineのデモ",
  subCommands: {
    transform: transformCommand,
    refine: refineCommand,
  },
});

if (process.argv[1]?.includes("14-transform-refine")) {
  runMain(cli, { version: "1.0.0" });
}
