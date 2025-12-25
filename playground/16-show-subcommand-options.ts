/**
 * 16-show-subcommand-options.ts - サブコマンドのオプションをまとめて表示する例
 *
 * 実行方法:
 *   pnpx tsx playground/16-show-subcommand-options.ts --help
 *   pnpx tsx playground/16-show-subcommand-options.ts --help-all  # または -H
 *   pnpx tsx playground/16-show-subcommand-options.ts config get user.name
 *   pnpx tsx playground/16-show-subcommand-options.ts config set user.name "John"
 *   pnpx tsx playground/16-show-subcommand-options.ts config list -f json
 *   pnpx tsx playground/16-show-subcommand-options.ts config list --help
 *
 * --help-all でサブコマンドのオプションも表示:
 *   Commands:
 *     config                      設定を管理
 *     config get                  設定値を取得
 *     config set                  設定値を設定
 *     config list                 全ての設定を一覧表示
 *       -f, --format <FORMAT>     出力形式 (default: "table")
 *       -g, --global              グローバル設定を表示 (default: false)
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
    global: arg(z.boolean().default(false), {
      alias: "g",
      description: "グローバル設定を表示",
    }),
  }),
  run: (args) => {
    console.log(`Listing all config (format: ${args.format}, global: ${args.global}):`);
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

// remote コマンド
const remoteAddCommand = defineCommand({
  name: "add",
  description: "リモートを追加",
  args: z.object({
    name: arg(z.string(), { positional: true, description: "リモート名" }),
    url: arg(z.string(), { positional: true, description: "リモートURL" }),
  }),
  run: (args) => {
    console.log(`Adding remote: ${args.name} -> ${args.url}`);
  },
});

const remoteRemoveCommand = defineCommand({
  name: "remove",
  description: "リモートを削除",
  args: z.object({
    name: arg(z.string(), { positional: true, description: "リモート名" }),
    force: arg(z.boolean().default(false), { alias: "f", description: "強制削除" }),
  }),
  run: (args) => {
    console.log(`Removing remote: ${args.name} (force: ${args.force})`);
  },
});

const remoteCommand = defineCommand({
  name: "remote",
  description: "リモートを管理",
  subCommands: {
    add: remoteAddCommand,
    remove: remoteRemoveCommand,
  },
});

// メインコマンド
const cli = defineCommand({
  name: "git-like",
  version: "1.0.0",
  description: "サブコマンドのオプションをまとめて表示する例",
  subCommands: {
    config: configCommand,
    remote: remoteCommand,
  },
});

// --help-all フラグでサブコマンドのオプションを表示できる
// ランタイムオプションとして showSubcommandOptions: true を指定することも可能
runMain(cli);
