/**
 * 10-subcommands.ts - サブコマンドの例
 *
 * 実行方法:
 *   pnpx tsx playground/10-subcommands.ts --help
 *   pnpx tsx playground/10-subcommands.ts init
 *   pnpx tsx playground/10-subcommands.ts init -t react
 *   pnpx tsx playground/10-subcommands.ts build
 *   pnpx tsx playground/10-subcommands.ts build -o out -m
 *   pnpx tsx playground/10-subcommands.ts build --help
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

// サブコマンド: init
const initCommand = defineCommand({
  name: "init",
  description: "プロジェクトを初期化",
  args: z.object({
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "テンプレート名",
    }),
    force: arg(z.boolean().default(false), {
      alias: "f",
      description: "既存ファイルを上書き",
    }),
  }),
  run: (args) => {
    console.log("Initializing project:");
    console.log(`  Template: ${args.template}`);
    if (args.force) {
      console.log("  (force mode)");
    }
  },
});

// サブコマンド: build
const buildCommand = defineCommand({
  name: "build",
  description: "プロジェクトをビルド",
  args: z.object({
    output: arg(z.string().default("dist"), {
      alias: "o",
      description: "出力ディレクトリ",
    }),
    minify: arg(z.boolean().default(false), {
      alias: "m",
      description: "出力を圧縮",
    }),
    watch: arg(z.boolean().default(false), {
      alias: "w",
      description: "ファイル変更を監視",
    }),
  }),
  run: (args) => {
    console.log("Building project:");
    console.log(`  Output: ${args.output}`);
    console.log(`  Minify: ${args.minify}`);
    if (args.watch) {
      console.log("  (watch mode)");
    }
  },
});

// メインコマンド
const cli = defineCommand({
  name: "my-cli",
  description: "サブコマンドを持つCLIの例",
  subCommands: {
    init: initCommand,
    build: buildCommand,
  },
});

runMain(cli, { version: "1.0.0" });
