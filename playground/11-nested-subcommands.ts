/**
 * 11-nested-subcommands.ts - ネストしたサブコマンドの例
 *
 * 実行方法:
 *   pnpx tsx playground/11-nested-subcommands.ts --help
 *   pnpx tsx playground/11-nested-subcommands.ts config --help
 *   pnpx tsx playground/11-nested-subcommands.ts config get user.name
 *   pnpx tsx playground/11-nested-subcommands.ts config set user.name "John Doe"
 *   pnpx tsx playground/11-nested-subcommands.ts config list
 *   pnpx tsx playground/11-nested-subcommands.ts config list --format json
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

// config get コマンド
const configGetCommand = defineCommand({
  name: "get",
  description: "設定値を取得",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "設定キー",
    }),
  }),
  run: (args) => {
    console.log(`Getting config: ${args.key}`);
    // 実際にはここで設定を読み込む
    console.log(`  Value: (simulated value for ${args.key})`);
  },
});

// config set コマンド
const configSetCommand = defineCommand({
  name: "set",
  description: "設定値を設定",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "設定キー",
    }),
    value: arg(z.string(), {
      positional: true,
      description: "設定値",
    }),
  }),
  run: (args) => {
    console.log(`Setting config: ${args.key} = ${args.value}`);
  },
});

// config list コマンド
const configListCommand = defineCommand({
  name: "list",
  description: "全ての設定を一覧表示",
  args: z.object({
    format: arg(z.enum(["table", "json", "yaml"]).default("table"), {
      alias: "f",
      description: "出力形式",
    }),
  }),
  run: (args) => {
    console.log(`Listing all config (format: ${args.format}):`);
    const config = {
      "user.name": "John",
      "user.email": "john@example.com",
      "core.editor": "vim",
    };
    if (args.format === "json") {
      console.log(JSON.stringify(config, null, 2));
    } else {
      for (const [key, value] of Object.entries(config)) {
        console.log(`  ${key} = ${value}`);
      }
    }
  },
});

// config コマンド（サブコマンドを持つ）
const configCommand = defineCommand({
  name: "config",
  description: "設定を管理",
  subCommands: {
    get: configGetCommand,
    set: configSetCommand,
    list: configListCommand,
  },
});

// メインコマンド
const cli = defineCommand({
  name: "git-like",
  version: "1.0.0",
  description: "Git風のネストしたサブコマンドの例",
  subCommands: {
    config: configCommand,
  },
});

runMain(cli);
