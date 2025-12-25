/**
 * 09-convert-command.ts - オプションpositional引数の例
 *
 * 実行方法:
 *   pnpx tsx playground/09-convert-command.ts input.json
 *   pnpx tsx playground/09-convert-command.ts input.json output.yaml
 *   pnpx tsx playground/09-convert-command.ts input.json output.yaml -f yaml
 *   pnpx tsx playground/09-convert-command.ts data.json -f toml
 *   pnpx tsx playground/09-convert-command.ts --help
 */

import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

const command = defineCommand({
  name: "convert",
  description: "ファイル形式を変換する（オプションpositionalの例）",
  args: z.object({
    input: arg(z.string(), {
      positional: true,
      description: "入力ファイル",
    }),
    output: arg(z.string().optional(), {
      positional: true,
      description: "出力ファイル（省略時は標準出力）",
    }),
    format: arg(z.enum(["json", "yaml", "toml"]).default("json"), {
      alias: "f",
      description: "出力形式",
    }),
  }),
  run: (args) => {
    const destination = args.output ?? "stdout";
    console.log("Converting:");
    console.log(`  Input: ${args.input}`);
    console.log(`  Output: ${destination}`);
    console.log(`  Format: ${args.format}`);
  },
});

runMain(command);
