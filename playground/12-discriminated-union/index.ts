/**
 * 12-discriminated-union.ts - discriminatedUnionの例（相互排他オプション）
 *
 * 実行方法:
 *   pnpx tsx playground/12-discriminated-union.ts --help
 *   pnpx tsx playground/12-discriminated-union.ts --action create --name my-resource
 *   pnpx tsx playground/12-discriminated-union.ts --action create --name my-resource --template basic
 *   pnpx tsx playground/12-discriminated-union.ts --action delete --id 123
 *   pnpx tsx playground/12-discriminated-union.ts --action delete --id 456 -f
 *   pnpx tsx playground/12-discriminated-union.ts --action list
 *   pnpx tsx playground/12-discriminated-union.ts --action list -f json
 */

import { z } from "zod";
import { arg, defineCommand, runMain } from "../../src/index.js";

export const command = defineCommand({
  name: "resource",
  description: "リソースを管理（discriminatedUnionの例）",
  args: z
    .discriminatedUnion("action", [
      // create アクション
      z
        .object({
          action: z.literal("create"),
          name: arg(z.string(), { description: "リソース名" }),
          template: arg(z.string().optional(), { description: "テンプレート" }),
        })
        .describe("新しいリソースを作成"),
      // delete アクション
      z
        .object({
          action: z.literal("delete"),
          id: arg(z.coerce.number(), { description: "リソースID" }),
          force: arg(z.boolean().default(false), {
            alias: "f",
            description: "確認なしで削除",
          }),
        })
        .describe("既存のリソースを削除"),
      // list アクション
      z.object({
        action: z.literal("list"),
        format: arg(z.enum(["json", "table"]).default("table"), {
          alias: "f",
          description: "出力形式",
        }),
        limit: arg(z.coerce.number().default(10), {
          alias: "n",
          description: "表示件数",
        }),
      }),
    ])
    .describe("操作"),
  run: (args) => {
    switch (args.action) {
      case "create":
        console.log("Creating resource:");
        console.log(`  Name: ${args.name}`);
        if (args.template) {
          console.log(`  Template: ${args.template}`);
        }
        break;

      case "delete":
        console.log("Deleting resource:");
        console.log(`  ID: ${args.id}`);
        if (args.force) {
          console.log("  (force mode - no confirmation)");
        }
        break;

      case "list":
        console.log("Listing resources:");
        console.log(`  Format: ${args.format}`);
        console.log(`  Limit: ${args.limit}`);
        // 実際にはここでリソースを一覧表示
        console.log("  (simulated resource list)");
        break;
    }
  },
});

if (process.argv[1]?.includes("12-discriminated-union")) {
  runMain(command);
}
