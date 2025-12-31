/**
 * 05-lifecycle-hooks.ts - ライフサイクルフックの例
 *
 * 実行方法:
 *   pnpx tsx playground/05-lifecycle-hooks.ts --database "postgres://localhost/mydb" --query "SELECT * FROM users"
 *   pnpx tsx playground/05-lifecycle-hooks.ts -d "mysql://localhost/test" -q "SELECT 1"
 *   pnpx tsx playground/05-lifecycle-hooks.ts --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "db-query",
  description: "データベースクエリの実行（ライフサイクルフックのデモ）",
  notes: `このコマンドは setup → run → cleanup の実行順序を示します。
--simulate-error フラグを使用すると、エラー発生時でも cleanup が呼ばれることを確認できます。`,
  args: z.object({
    database: arg(z.string(), {
      alias: "d",
      description: "データベース接続文字列",
    }),
    query: arg(z.string(), {
      alias: "q",
      description: "SQLクエリ",
    }),
    simulate_error: arg(z.boolean().default(false), {
      alias: "e",
      description: "エラーをシミュレート",
    }),
  }),
  setup: async ({ args }) => {
    console.log("[setup] Connecting to database...");
    console.log(`[setup] Connection string: ${args.database}`);
    // 実際にはここでDB接続を確立
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("[setup] Connected!");
  },
  run: async (args) => {
    console.log("[run] Executing query...");
    console.log(`[run] Query: ${args.query}`);

    if (args.simulate_error) {
      throw new Error("Simulated database error!");
    }

    // 実際にはここでクエリを実行
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log("[run] Query completed!");
    return { rowCount: 42, success: true };
  },
  cleanup: async ({ error }) => {
    console.log("[cleanup] Closing database connection...");
    if (error) {
      console.error(`[cleanup] Error occurred: ${error.message}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.log("[cleanup] Connection closed.");
  },
});

if (process.argv[1]?.includes("05-lifecycle-hooks")) {
  runMain(command);
}
