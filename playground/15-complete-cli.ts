/**
 * 15-complete-cli.ts - 完全なCLIの例
 *
 * 実行方法:
 *   pnpx tsx playground/15-complete-cli.ts --help
 *   pnpx tsx playground/15-complete-cli.ts --version
 *   pnpx tsx playground/15-complete-cli.ts file.txt -o out.txt
 *   pnpx tsx playground/15-complete-cli.ts file.txt -o out.txt -v
 *   pnpx tsx playground/15-complete-cli.ts init
 *   pnpx tsx playground/15-complete-cli.ts init -t react
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

// init サブコマンド
export const initCommand = defineCommand({
  name: "init",
  description: "新しいプロジェクトを初期化",
  args: z.object({
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "使用するテンプレート",
    }),
    name: arg(z.string().optional(), {
      alias: "n",
      description: "プロジェクト名",
    }),
  }),
  run: (args) => {
    const projectName = args.name ?? "my-project";
    console.log(`Initializing project "${projectName}" with template "${args.template}"...`);
    console.log("Done!");
  },
});

// メインCLI
export const cli = defineCommand({
  name: "my-tool",
  description: "完全なCLIツールの例",
  args: z.object({
    input: arg(z.string(), {
      positional: true,
      description: "入力ファイル",
    }),
    output: arg(z.string(), {
      alias: "o",
      description: "出力ファイル",
    }),
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "詳細出力を有効にする",
    }),
    format: arg(z.enum(["json", "yaml", "toml"]).default("json"), {
      alias: "f",
      description: "出力形式",
    }),
  }),
  subCommands: {
    init: initCommand,
  },
  setup: async ({ args }) => {
    if (args.verbose) {
      console.log("[setup] Initializing...");
    }
  },
  run: async (args) => {
    if (args.verbose) {
      console.log("[run] Processing...");
    }

    console.log("Processing:");
    console.log(`  Input: ${args.input}`);
    console.log(`  Output: ${args.output}`);
    console.log(`  Format: ${args.format}`);

    // 処理をシミュレート
    await new Promise((resolve) => setTimeout(resolve, 100));

    return { processed: true, format: args.format };
  },
  cleanup: async ({ args, error }) => {
    if (args.verbose) {
      console.log("[cleanup] Cleaning up...");
    }
    if (error) {
      console.error(`[cleanup] Error: ${error.message}`);
    }
  },
});

if (process.argv[1]?.includes("15-complete-cli")) {
  runMain(cli, { version: "2.0.0" });
}
