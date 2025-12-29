/**
 * 17-deep-nested-subcommands.ts - 3階層以上のネストしたサブコマンドの例
 *
 * 構造:
 *   git-like
 *     └── config
 *           ├── user
 *           │     ├── get
 *           │     └── set
 *           └── core
 *                 ├── get
 *                 └── set
 *
 * 実行方法:
 *   pnpx tsx playground/17-deep-nested-subcommands.ts --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user get --help
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user get name
 *   pnpx tsx playground/17-deep-nested-subcommands.ts config user set name "John Doe"
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

// config user get コマンド
export const configUserGetCommand = defineCommand({
  name: "get",
  description: "ユーザー設定値を取得",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "設定キー (name, email など)",
    }),
  }),
  run: (args) => {
    const values: Record<string, string> = {
      name: "John Doe",
      email: "john@example.com",
    };
    console.log(`user.${args.key} = ${values[args.key] ?? "(not set)"}`);
  },
});

// config user set コマンド
export const configUserSetCommand = defineCommand({
  name: "set",
  description: "ユーザー設定値を設定",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "設定キー",
    }),
    value: arg(z.string(), {
      positional: true,
      description: "設定値",
    }),
    global: arg(z.boolean().default(false), {
      alias: "g",
      description: "グローバル設定として保存",
    }),
  }),
  run: (args) => {
    const scope = args.global ? "global" : "local";
    console.log(`Setting user.${args.key} = ${args.value} (${scope})`);
  },
});

// config user コマンド
export const configUserCommand = defineCommand({
  name: "user",
  description: "ユーザー設定を管理",
  subCommands: {
    get: configUserGetCommand,
    set: configUserSetCommand,
  },
});

// config core get コマンド
export const configCoreGetCommand = defineCommand({
  name: "get",
  description: "コア設定値を取得",
  args: z.object({
    key: arg(z.string(), {
      positional: true,
      description: "設定キー (editor, pager など)",
    }),
  }),
  run: (args) => {
    const values: Record<string, string> = {
      editor: "vim",
      pager: "less",
    };
    console.log(`core.${args.key} = ${values[args.key] ?? "(not set)"}`);
  },
});

// config core set コマンド
export const configCoreSetCommand = defineCommand({
  name: "set",
  description: "コア設定値を設定",
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
    console.log(`Setting core.${args.key} = ${args.value}`);
  },
});

// config core コマンド
export const configCoreCommand = defineCommand({
  name: "core",
  description: "コア設定を管理",
  subCommands: {
    get: configCoreGetCommand,
    set: configCoreSetCommand,
  },
});

// config コマンド
export const configCommand = defineCommand({
  name: "config",
  description: "設定を管理",
  subCommands: {
    user: configUserCommand,
    core: configCoreCommand,
  },
});

// メインコマンド
export const cli = defineCommand({
  name: "git-like",
  description: "3階層ネストしたサブコマンドの例",
  subCommands: {
    config: configCommand,
  },
});

if (process.argv[1]?.includes("17-deep-nested-subcommands")) {
  runMain(cli, { version: "1.0.0" });
}
