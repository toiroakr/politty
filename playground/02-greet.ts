/**
 * 02-greet.ts - 引数付きの挨拶コマンド
 *
 * 実行方法:
 *   pnpx tsx playground/02-greet.ts World
 *   pnpx tsx playground/02-greet.ts World -g "Hi" -l
 *   pnpx tsx playground/02-greet.ts --help
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

export const command = defineCommand({
  name: "greet",
  description: "挨拶を表示するCLIツール",
  args: z.object({
    name: arg(z.string().meta({}), {
      positional: true,
      description: "挨拶する相手の名前",
    }),
    greeting: arg(z.string().default("Hello"), {
      alias: "g",
      description: "挨拶のフレーズ",
    }),
    loud: arg(z.boolean().default(false), {
      alias: "l",
      description: "大文字で出力",
    }),
  }),
  run: (args) => {
    let message = `${args.greeting}, ${args.name}!`;
    if (args.loud) {
      message = message.toUpperCase();
    }
    console.log(message);
    return message;
  },
});

if (process.argv[1]?.includes("02-greet")) {
  runMain(command, { version: "1.0.0" });
}
