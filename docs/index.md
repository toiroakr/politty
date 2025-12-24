# politty

**politty** は、**Zod v4** をベースにした、軽量で型安全な Node.js 用 CLI フレームワークです。

シンプルなスクリプトから、サブコマンド、バリデーション、自動ヘルプ生成を備えた複雑な CLI ツールまで、開発者フレンドリーな API で構築できます。

## 特徴

-   **Zod ネイティブ**: 引数の定義とバリデーションに Zod スキーマをそのまま使用可能
-   **型安全性**: TypeScript を完全サポートし、パースされた引数の型を自動推論
-   **柔軟な引数定義**: Positional 引数、フラグ、エイリアス、配列をサポート
-   **ネストされたコマンド**: Git スタイルのサブコマンド構築が可能
-   **ライフサイクル管理**: `setup` → `run` → `cleanup` の実行順序を保証

## ドキュメント体系

-   **[Getting Started](./getting-started.md)**: インストールと最初のコマンド作成
-   **[Essentials](./essentials.md)**: コアコンセプト（引数、バリデーション、ライフサイクル）の解説
-   **[Advanced Features](./advanced-features.md)**: サブコマンド、Discriminated Union、高度な機能
-   **[Recipes](./recipes.md)**: テスト、設定、エラーハンドリングなどの実践例
-   **[API Reference](./api-reference.md)**: 詳細な API リファレンス

## クイックサンプル

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  args: z.object({
    name: arg(z.string(), { positional: true }),
    loud: arg(z.boolean().default(false), { alias: "l" }),
  }),
  run: ({ args }) => {
    const msg = `Hello, ${args.name}!`;
    console.log(args.loud ? msg.toUpperCase() : msg);
  },
});

runMain(command);
```

## ライセンス

MIT
