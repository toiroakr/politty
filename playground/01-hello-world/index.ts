/**
 * 01-hello-world.ts - 最小構成のコマンド
 *
 * 実行方法:
 *   pnpx tsx playground/01-hello-world.ts
 *   pnpx tsx playground/01-hello-world.ts --help
 */

import { defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "hello",
  description: "Hello Worldを表示するシンプルなコマンド",
  run: () => {
    console.log("Hello, World!");
  },
});

if (process.argv[1]?.includes("01-hello-world")) {
  runMain(command, { version: "1.0.0" });
}
