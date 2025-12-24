# はじめに

このガイドでは politty の基本的な使い方を説明します。

## インストール

politty は Zod v4 を必要とします。

```bash
npm install politty zod
# または
pnpm add politty zod
# または
yarn add politty zod
```

## 基本的なコマンドの作成

### 最小構成

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

### 引数付きコマンド

引数を定義するには、Zod スキーマと `arg()` ヘルパーを使用します。

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  args: z.object({
    name: arg(z.string(), {
      description: "名前",
      positional: true,
    }),
  }),
  run: ({ args }) => {
    console.log(`Hello, ${args.name}!`);
  },
});

runMain(command);
```

## 引数の種類

### Positional引数

コマンドラインで位置によって指定される引数です。

```typescript
args: z.object({
  input: arg(z.string(), { positional: true }),
  output: arg(z.string(), { positional: true }),
})
```

```bash
$ my-cli input.txt output.txt
```

### オプション（Named引数）

`--flag` や `-f` で指定される引数です。

```typescript
args: z.object({
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "詳細出力",
  }),
  config: arg(z.string(), {
    alias: "c",
    description: "設定ファイルのパス",
  }),
})
```

```bash
$ my-cli --verbose --config config.json
$ my-cli -v -c config.json
```

### 配列引数

同じフラグを複数回指定できます。

```typescript
args: z.object({
  files: arg(z.array(z.string()), {
    alias: "f",
    description: "入力ファイル",
  }),
})
```

```bash
$ my-cli --files a.txt --files b.txt -f c.txt
# args.files = ["a.txt", "b.txt", "c.txt"]
```

## 型変換

Zod の `coerce` を使用して、文字列から他の型への変換が可能です。

```typescript
args: z.object({
  port: arg(z.coerce.number().min(1).max(65535), {
    alias: "p",
    description: "ポート番号",
  }),
  count: arg(z.coerce.number().int().positive(), {
    alias: "n",
    description: "繰り返し回数",
  }),
})
```

```bash
$ my-cli --port 8080 --count 5
# args.port = 8080 (number型)
# args.count = 5 (number型)
```

## デフォルト値

Zod の `.default()` でデフォルト値を設定できます。

```typescript
args: z.object({
  host: arg(z.string().default("localhost"), {
    description: "ホスト名",
  }),
  port: arg(z.coerce.number().default(3000), {
    alias: "p",
    description: "ポート番号",
  }),
})
```

## オプション引数

`.optional()` で引数をオプションにできます。

```typescript
args: z.object({
  config: arg(z.string().optional(), {
    alias: "c",
    description: "設定ファイル（省略可）",
  }),
})
```

## バリデーション

Zod の全てのバリデーション機能が使用できます。

```typescript
args: z.object({
  email: arg(z.string().email(), {
    description: "メールアドレス",
  }),
  age: arg(z.coerce.number().min(0).max(150), {
    description: "年齢",
  }),
  url: arg(z.string().url(), {
    description: "URL",
  }),
})
```

バリデーションエラーは自動的にフォーマットされて表示されます。

```bash
$ my-cli --email invalid --age -5
Error: Validation failed:
  - email: Invalid email
  - age: Number must be greater than or equal to 0
```

## ライフサイクルフック

`setup`、`run`、`cleanup` の3つのフックを使用できます。

```typescript
const command = defineCommand({
  name: "my-cli",
  args: z.object({
    database: arg(z.string(), { description: "DB接続文字列" }),
  }),
  setup: async ({ args }) => {
    // run の前に実行される
    console.log("Connecting to database...");
  },
  run: async ({ args }) => {
    // メイン処理
    console.log("Running main logic...");
    return { success: true };
  },
  cleanup: async ({ args, error }) => {
    // run の後に実行される（エラー時も実行）
    console.log("Cleaning up...");
    if (error) {
      console.error("Error occurred:", error.message);
    }
  },
});
```

実行順序:

1. `setup` が実行される
2. `run` が実行される
3. `cleanup` が実行される（`run` でエラーが発生しても実行）

## ヘルプとバージョン

`--help` と `--version` は自動的にサポートされます。

```typescript
const command = defineCommand({
  name: "my-cli",
  version: "1.0.0",
  description: "私のCLIツール",
  args: z.object({
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "詳細出力を有効にする",
    }),
  }),
  run: ({ args }) => { /* ... */ },
});
```

```bash
$ my-cli --help
my-cli v1.0.0
私のCLIツール

Usage: my-cli [options]

Options:
  -h, --help                  Show help
  --version                   Show version
  -v, --verbose               詳細出力を有効にする (default: false)
```

## 次のステップ

- [APIリファレンス](./api-reference.md) - 全ての関数・型の詳細
- [Positional引数](./positional-arguments.md) - positional引数の詳細なルール
- [応用例](./advanced-usage.md) - サブコマンド、discriminatedUnionなど
