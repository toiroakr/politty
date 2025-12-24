/**
 * 13-intersection.ts - intersectionの例（共通オプションの再利用）
 *
 * 実行方法:
 *   pnpx tsx playground/13-intersection.ts input.txt -o output.txt
 *   pnpx tsx playground/13-intersection.ts data.json -o result.json -v
 *   pnpx tsx playground/13-intersection.ts data.json -o result.json --verbose --config config.json
 *   pnpx tsx playground/13-intersection.ts --help
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

// 共通オプション（複数コマンドで再利用可能）
const baseOptions = z.object({
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "詳細出力",
  }),
  config: arg(z.string().optional(), {
    alias: "c",
    description: "設定ファイル",
  }),
  quiet: arg(z.boolean().default(false), {
    alias: "q",
    description: "出力を抑制",
  }),
});

// processコマンド固有のオプション
const processOptions = z.object({
  input: arg(z.string(), {
    positional: true,
    description: "入力ファイル",
  }),
  output: arg(z.string(), {
    alias: "o",
    description: "出力ファイル",
  }),
});

// intersectionで結合
const command = defineCommand({
  name: "process",
  description: "ファイルを処理（intersectionの例）",
  args: baseOptions.and(processOptions),
  run: ({ args }) => {
    if (!args.quiet) {
      console.log("Processing file:");
      console.log(`  Input: ${args.input}`);
      console.log(`  Output: ${args.output}`);

      if (args.config) {
        console.log(`  Config: ${args.config}`);
      }

      if (args.verbose) {
        console.log("  (verbose mode enabled)");
        console.log("  Step 1: Reading input file...");
        console.log("  Step 2: Processing data...");
        console.log("  Step 3: Writing output file...");
      }
    }

    console.log("Done!");
  },
});

runMain(command);
