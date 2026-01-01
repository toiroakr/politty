/**
 * 22-doc-with-mock-output - モックを使った出力例付きドキュメント生成
 *
 * このサンプルでは、コマンドの実行結果をモックでキャプチャし、
 * ドキュメントに出力例として含める方法を示します。
 *
 * 実行方法:
 *   pnpx tsx playground/22-doc-with-mock-output Alice
 *   pnpx tsx playground/22-doc-with-mock-output Alice --format json
 *   pnpx tsx playground/22-doc-with-mock-output --help
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "user-info",
  description: "ユーザー情報を表示するCLIツール",
  args: z.object({
    name: arg(z.string(), {
      positional: true,
      description: "ユーザー名",
    }),
    format: arg(z.enum(["text", "json"]).default("text"), {
      alias: "f",
      description: "出力フォーマット",
    }),
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "詳細情報を表示",
    }),
  }),
  run: (args) => {
    const userInfo = {
      name: args.name,
      createdAt: "2024-01-15",
      role: "developer",
      ...(args.verbose && {
        email: `${args.name.toLowerCase()}@example.com`,
        lastLogin: "2024-03-20",
      }),
    };

    if (args.format === "json") {
      console.log(JSON.stringify(userInfo, null, 2));
    } else {
      console.log(`User: ${userInfo.name}`);
      console.log(`Role: ${userInfo.role}`);
      console.log(`Created: ${userInfo.createdAt}`);
      if (args.verbose) {
        console.log(`Email: ${userInfo.email}`);
        console.log(`Last Login: ${userInfo.lastLogin}`);
      }
    }

    return userInfo;
  },
});

if (process.argv[1]?.includes("22-doc-with-mock-output")) {
  runMain(command, { version: "1.0.0" });
}
