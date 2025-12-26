/**
 * 04-type-coercion.ts - 型変換とバリデーションの例
 *
 * 実行方法:
 *   pnpx tsx playground/04-type-coercion.ts -p 8080 -n 5
 *   pnpx tsx playground/04-type-coercion.ts --port 3000 --count 10
 *   pnpx tsx playground/04-type-coercion.ts -p 99999    # バリデーションエラー
 *   pnpx tsx playground/04-type-coercion.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../src/index.js";

export const command = defineCommand({
  name: "server",
  description: "サーバー設定の例（型変換とバリデーション）",
  args: z.object({
    port: arg(z.coerce.number().int().min(1).max(65535), {
      alias: "p",
      description: "ポート番号 (1-65535)",
    }),
    count: arg(z.coerce.number().int().positive().default(1), {
      alias: "n",
      description: "繰り返し回数",
    }),
    host: arg(z.string().default("localhost"), {
      alias: "h",
      description: "ホスト名",
      overrideBuiltinAlias: true,
    }),
  }),
  run: (args) => {
    console.log("Server Configuration:");
    console.log(`  Host: ${args.host}`);
    console.log(`  Port: ${args.port} (type: ${typeof args.port})`);
    console.log(`  Count: ${args.count} (type: ${typeof args.count})`);
  },
});

if (process.argv[1]?.includes("04-type-coercion")) {
  runMain(command);
}
