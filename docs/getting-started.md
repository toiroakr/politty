# Getting Started

## インストール

politty は **Zod v4** を必要とします。

```bash
npm install politty zod
# または
pnpm add politty zod
# または
yarn add politty zod
```

## 最初のコマンド

最小構成の「Hello World」の例です。

```typescript
import { defineCommand, runMain } from "politty";

const command = defineCommand({
  name: "my-cli",
  run: () => {
    console.log("Hello, World!");
  },
});

runMain(command);
```

`tsx` や `ts-node` でローカル実行できます：

```bash
$ npx tsx index.ts
Hello, World!
```

## 引数の追加

`z.object` と `arg()` を使って引数を定義します。

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  args: z.object({
    // Positional引数: greet <name>
    name: arg(z.string(), {
      positional: true,
      description: "挨拶する名前"
    }),

    // オプションフラグ: --loud / -l
    loud: arg(z.boolean().default(false), {
      alias: "l",
      description: "大声で挨拶する"
    }),
  }),
  run: (args) => {
    const message = `Hello, ${args.name}!`;
    console.log(args.loud ? message.toUpperCase() : message);
  },
});

runMain(command);
```

```bash
$ npx tsx greet.ts World
Hello, World!

$ npx tsx greet.ts World --loud
HELLO, WORLD!
```

## 次のステップ

基本を理解したら、以下のガイドで詳細を確認してください：

- **[Essentials](./essentials.md)**: 引数、バリデーション、ライフサイクルフックの詳細
- **[Advanced Features](./advanced-features.md)**: サブコマンド、ネスト構造、複雑なスキーマ
- **[Recipes](./recipes.md)**: テスト手法、エラーハンドリング、設定など
