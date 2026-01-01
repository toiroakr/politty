# politty

**politty** は、**Zod v4** をベースにした、軽量で型安全な Node.js 用 CLI フレームワークです。

シンプルなスクリプトから、サブコマンド、バリデーション、自動ヘルプ生成を備えた複雑な CLI ツールまで、開発者フレンドリーな API で構築できます。

## 特徴

- **Zod ネイティブ**: 引数の定義とバリデーションに Zod スキーマをそのまま使用
- **型安全性**: TypeScript を完全サポートし、パースされた引数の型を自動推論
- **柔軟な引数定義**: Positional 引数、フラグ、エイリアス、配列、環境変数フォールバックをサポート
- **サブコマンド**: Git スタイルのネストされたサブコマンド構築が可能（遅延読み込み対応）
- **ライフサイクル管理**: `setup` → `run` → `cleanup` の実行順序を保証
- **シグナルハンドリング**: SIGINT/SIGTERM を適切に処理し、cleanup の実行を保証
- **自動ヘルプ生成**: 定義から自動的にヘルプテキストを生成
- **Discriminated Union**: 相互排他的な引数セットのサポート

## 動作環境

- Node.js >= 18
- Zod >= 4.2.1

## インストール

```bash
npm install politty zod
# or
pnpm add politty zod
# or
yarn add politty zod
```

## クイックスタート

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "greet",
  description: "挨拶を表示するCLIツール",
  args: z.object({
    name: arg(z.string(), {
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
  run: ({ args }) => {
    let message = `${args.greeting}, ${args.name}!`;
    if (args.loud) {
      message = message.toUpperCase();
    }
    console.log(message);
  },
});

runMain(command);
```

実行例:

```bash
$ my-cli World
Hello, World!

$ my-cli World -g "Hi" -l
HI, WORLD!

$ my-cli --help
Usage: greet <name> [options]

挨拶を表示するCLIツール

Arguments:
  name    挨拶する相手の名前

Options:
  -g, --greeting <value>  挨拶のフレーズ (default: "Hello")
  -l, --loud              大文字で出力
  -h, --help              Show help
```

## 基本的な使い方

### 引数の定義

`arg()` 関数を使って引数のメタデータを定義します:

```typescript
import { z } from "zod";
import { arg, defineCommand } from "politty";

const command = defineCommand({
  name: "example",
  args: z.object({
    // Positional 引数（必須）
    input: arg(z.string(), {
      positional: true,
      description: "入力ファイル",
    }),

    // オプショナルな Positional 引数
    output: arg(z.string().optional(), {
      positional: true,
      description: "出力ファイル",
    }),

    // フラグ（エイリアス付き）
    verbose: arg(z.boolean().default(false), {
      alias: "v",
      description: "詳細出力",
    }),

    // 環境変数からのフォールバック
    apiKey: arg(z.string().optional(), {
      env: "API_KEY",
      description: "API キー",
    }),

    // 配列引数（--file a.txt --file b.txt）
    files: arg(z.array(z.string()).default([]), {
      alias: "f",
      description: "処理するファイル",
    }),
  }),
  run: ({ args }) => {
    console.log(args);
  },
});
```

### サブコマンド

Git スタイルのサブコマンドを定義できます:

```typescript
import { z } from "zod";
import { arg, defineCommand, runMain } from "politty";

const initCommand = defineCommand({
  name: "init",
  description: "プロジェクトを初期化",
  args: z.object({
    template: arg(z.string().default("default"), {
      alias: "t",
      description: "テンプレート名",
    }),
  }),
  run: ({ args }) => {
    console.log(`Initializing with template: ${args.template}`);
  },
});

const buildCommand = defineCommand({
  name: "build",
  description: "プロジェクトをビルド",
  args: z.object({
    output: arg(z.string().default("dist"), {
      alias: "o",
      description: "出力ディレクトリ",
    }),
    minify: arg(z.boolean().default(false), {
      alias: "m",
      description: "出力を圧縮",
    }),
  }),
  run: ({ args }) => {
    console.log(`Building to: ${args.output}`);
  },
});

const cli = defineCommand({
  name: "my-cli",
  description: "サブコマンドを持つCLIの例",
  subCommands: {
    init: initCommand,
    build: buildCommand,
  },
});

runMain(cli, { version: "1.0.0" });
```

実行例:

```bash
$ my-cli init -t react
$ my-cli build -o out -m
$ my-cli --help
```

### ライフサイクルフック

`setup` → `run` → `cleanup` の順序でフックを実行します。エラーが発生しても `cleanup` は必ず実行されます:

```typescript
const command = defineCommand({
  name: "db-query",
  description: "データベースクエリの実行",
  args: z.object({
    database: arg(z.string(), {
      alias: "d",
      description: "データベース接続文字列",
    }),
    query: arg(z.string(), {
      alias: "q",
      description: "SQLクエリ",
    }),
  }),
  setup: async ({ args }) => {
    console.log("[setup] Connecting to database...");
    // DB接続を確立
  },
  run: async ({ args }) => {
    console.log("[run] Executing query...");
    // クエリを実行
    return { rowCount: 42 };
  },
  cleanup: async ({ error }) => {
    console.log("[cleanup] Closing connection...");
    if (error) {
      console.error(`Error occurred: ${error.message}`);
    }
    // 接続をクローズ
  },
});
```

## API

### `defineCommand(options)`

コマンドを定義します。

| オプション | 型 | 説明 |
|-----------|------|------|
| `name` | `string` | コマンド名 |
| `description` | `string?` | コマンドの説明 |
| `args` | `ZodSchema` | 引数のスキーマ |
| `subCommands` | `Record<string, Command>?` | サブコマンド |
| `setup` | `(context) => Promise<void>?` | セットアップフック |
| `run` | `(context) => Promise<T>?` | 実行関数 |
| `cleanup` | `(context) => Promise<void>?` | クリーンアップフック |

### `runMain(command, options?)`

CLI エントリーポイント。シグナルハンドリングと `process.exit()` を行います。

```typescript
runMain(command, {
  version: "1.0.0",    // --version フラグで表示
  argv: process.argv,  // カスタム argv
});
```

### `runCommand(command, argv, options?)`

プログラマティック/テスト用のエントリーポイント。`process.exit()` を呼び出さず、結果オブジェクトを返します。

```typescript
const result = await runCommand(command, ["arg1", "--flag"]);
if (result.success) {
  console.log(result.value);
} else {
  console.error(result.error);
}
```

### `arg(schema, meta)`

引数にメタデータを付与します。

| メタデータ | 型 | 説明 |
|-----------|------|------|
| `positional` | `boolean?` | Positional 引数として扱う |
| `alias` | `string?` | 短いエイリアス（例: `-v`） |
| `description` | `string?` | 引数の説明 |
| `placeholder` | `string?` | ヘルプに表示するプレースホルダー |
| `env` | `string?` | 環境変数名（フォールバック用） |

## ドキュメント

詳細なドキュメントは `docs/` ディレクトリを参照してください:

- [Getting Started](./docs/getting-started.md) - インストールと最初のコマンド作成
- [Essentials](./docs/essentials.md) - コアコンセプトの解説
- [Advanced Features](./docs/advanced-features.md) - サブコマンド、Discriminated Union
- [Recipes](./docs/recipes.md) - テスト、設定、エラーハンドリング
- [API Reference](./docs/api-reference.md) - 詳細な API リファレンス
- [Doc Generation](./docs/doc-generation.md) - ドキュメント自動生成

## サンプル

`playground/` ディレクトリに多数のサンプルがあります:

- `01-hello-world` - 最小構成のコマンド
- `02-greet` - Positional 引数とフラグ
- `03-array-args` - 配列引数
- `05-lifecycle-hooks` - ライフサイクルフック
- `10-subcommands` - サブコマンド
- `12-discriminated-union` - Discriminated Union
- `21-lazy-subcommands` - 遅延読み込み

## ライセンス

MIT
