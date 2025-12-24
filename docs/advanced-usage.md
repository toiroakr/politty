# 応用例

このドキュメントでは、politty の高度な使い方について説明します。

## サブコマンド

git や npm のようなサブコマンドを持つCLIを構築できます。

### 基本的なサブコマンド

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

// サブコマンドの定義
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
      description: "圧縮する",
    }),
  }),
  run: ({ args }) => {
    console.log(`Building to ${args.output}, minify: ${args.minify}`);
  },
});

// メインコマンド
const cli = defineCommand({
  name: "my-cli",
  version: "1.0.0",
  description: "私のCLIツール",
  subCommands: {
    init: initCommand,
    build: buildCommand,
  },
});

runMain(cli);
```

```bash
$ my-cli init -t react
Initializing with template: react

$ my-cli build -o out -m
Building to out, minify: true

$ my-cli --help
my-cli v1.0.0
私のCLIツール

Usage: my-cli [options] [command]

Options:
  -h, --help                  Show help
  --version                   Show version

Commands:
  init                        プロジェクトを初期化
  build                       プロジェクトをビルド
```

### 遅延ロードサブコマンド

サブコマンドを動的にロードすることで、起動時間を短縮できます。

```typescript
const cli = defineCommand({
  name: "my-cli",
  subCommands: {
    // 同期的なサブコマンド
    quick: defineCommand({
      name: "quick",
      run: () => console.log("Quick command"),
    }),

    // 遅延ロードサブコマンド
    heavy: async () => {
      // 必要な時にのみインポート
      const { heavyCommand } = await import("./commands/heavy.js");
      return heavyCommand;
    },
  },
});
```

### ネストしたサブコマンド

サブコマンドはネストできます。

```typescript
const configGetCommand = defineCommand({
  name: "get",
  description: "設定値を取得",
  args: z.object({
    key: arg(z.string(), { positional: true }),
  }),
  run: ({ args }) => {
    console.log(`Getting config: ${args.key}`);
  },
});

const configSetCommand = defineCommand({
  name: "set",
  description: "設定値を設定",
  args: z.object({
    key: arg(z.string(), { positional: true }),
    value: arg(z.string(), { positional: true }),
  }),
  run: ({ args }) => {
    console.log(`Setting config: ${args.key} = ${args.value}`);
  },
});

const configCommand = defineCommand({
  name: "config",
  description: "設定を管理",
  subCommands: {
    get: configGetCommand,
    set: configSetCommand,
  },
});

const cli = defineCommand({
  name: "my-cli",
  subCommands: {
    config: configCommand,
  },
});
```

```bash
$ my-cli config get user.name
Getting config: user.name

$ my-cli config set user.name "John"
Setting config: user.name = John
```

### サブコマンドのオプションをまとめて表示

サブコマンドを持つコマンドでは、`--help-all`（または `-H`）フラグを使用してすべてのサブコマンドのオプションを表示できます。

```bash
$ my-cli --help-all
# または
$ my-cli -H
```

出力例：

```
my-cli v1.0.0

Usage: my-cli [command]

Options:
  -h, --help                  Show help
  -H, --help-all              Show help with all subcommand options
  --version                   Show version

Commands:
  config                      設定を管理
  config get                  設定値を取得
  config set                  設定値を設定
  config list                 全ての設定を一覧表示
    -f, --format <FORMAT>     出力形式 (default: "table")
```

通常の `--help` では基本情報のみが表示され、`--help-all` で詳細な情報が表示されます。

#### サブコマンド個別のヘルプ

サブコマンドに対して直接 `--help` を使用することもできます：

```bash
$ my-cli config --help      # config サブコマンドのヘルプ
$ my-cli config list --help # config list サブコマンドのヘルプ
```

#### ランタイムオプション

`showSubcommandOptions: true` をランタイムオプションとして指定すると、`--help` でも詳細なサブコマンド情報を表示できます：

```typescript
runMain(cli, { showSubcommandOptions: true });
```

## DiscriminatedUnion

Zod の `discriminatedUnion` を使用して、相互排他的なオプションを定義できます。

### 基本的な使い方

```typescript
import { z } from "zod";
import { defineCommand, runMain, arg } from "politty";

const command = defineCommand({
  name: "resource",
  args: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("create"),
      name: arg(z.string(), { description: "リソース名" }),
      template: arg(z.string().optional(), { description: "テンプレート" }),
    }),
    z.object({
      action: z.literal("delete"),
      id: arg(z.coerce.number(), { description: "リソースID" }),
      force: arg(z.boolean().default(false), { alias: "f" }),
    }),
    z.object({
      action: z.literal("list"),
      format: arg(z.enum(["json", "table"]).default("table"), {
        alias: "f",
        description: "出力形式",
      }),
    }),
  ]),
  run: ({ args }) => {
    switch (args.action) {
      case "create":
        console.log(`Creating resource: ${args.name}`);
        break;
      case "delete":
        console.log(`Deleting resource: ${args.id}`);
        break;
      case "list":
        console.log(`Listing in ${args.format} format`);
        break;
    }
  },
});

runMain(command);
```

```bash
$ resource --action create --name my-resource
Creating resource: my-resource

$ resource --action delete --id 123 -f
Deleting resource: 123

$ resource --action list -f json
Listing in json format
```

### ヘルプ表示

discriminatedUnion を使用すると、ヘルプはバリアントごとに整理されて表示されます。

```
resource

Usage: resource [options]

Options:
  -h, --help                  Show help
  -H, --help-all              Show help with all subcommand options
  --action <create|delete|list>Action to perform

  When action=create:
    --name <NAME>             リソース名 (required)
    --template <TEMPLATE>     テンプレート

  When action=delete:
    --id <ID>                 リソースID (required)
    -f, --force               (default: false)

  When action=list:
    -f, --format <FORMAT>     出力形式 (default: "table")
```

## Intersection

`z.intersection()` または `.and()` を使用して、複数のスキーマを組み合わせることができます。

```typescript
const baseOptions = z.object({
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "詳細出力",
  }),
  config: arg(z.string().optional(), {
    alias: "c",
    description: "設定ファイル",
  }),
});

const command = defineCommand({
  name: "process",
  args: baseOptions.and(
    z.object({
      input: arg(z.string(), {
        positional: true,
        description: "入力ファイル",
      }),
      output: arg(z.string(), {
        alias: "o",
        description: "出力ファイル",
      }),
    })
  ),
  run: ({ args }) => {
    // args には baseOptions と追加のオプションの両方が含まれる
    console.log(`Processing ${args.input} -> ${args.output}`);
    console.log(`Verbose: ${args.verbose}`);
  },
});
```

## 型変換とバリデーション

### z.coerce を使用した型変換

```typescript
args: z.object({
  port: arg(z.coerce.number().int().min(1).max(65535), {
    alias: "p",
    description: "ポート番号",
  }),
  timeout: arg(z.coerce.number().positive(), {
    alias: "t",
    description: "タイムアウト（秒）",
  }),
  date: arg(z.coerce.date(), {
    alias: "d",
    description: "日付",
  }),
})
```

### transform を使用した変換

```typescript
args: z.object({
  name: arg(
    z.string().transform((s) => s.toUpperCase()),
    { positional: true }
  ),
  tags: arg(
    z.string().transform((s) => s.split(",")),
    { alias: "t", description: "カンマ区切りのタグ" }
  ),
})
```

```bash
$ my-cli hello --tags "a,b,c"
# args.name = "HELLO"
# args.tags = ["a", "b", "c"]
```

### refine を使用したカスタムバリデーション

```typescript
args: z.object({
  input: arg(z.string(), { positional: true }),
  output: arg(z.string(), { positional: true }),
}).refine(
  (data) => data.input !== data.output,
  { message: "入力と出力は異なるファイルを指定してください" }
)
```

## ライフサイクルフックの活用

### リソースの初期化と解放

```typescript
const command = defineCommand({
  name: "db-query",
  args: z.object({
    connectionString: arg(z.string(), {
      alias: "c",
      description: "データベース接続文字列",
    }),
    query: arg(z.string(), {
      alias: "q",
      description: "SQLクエリ",
    }),
  }),
  setup: async ({ args }) => {
    // データベース接続の初期化
    console.log(`Connecting to ${args.connectionString}...`);
    // 実際にはここでDB接続を確立
  },
  run: async ({ args }) => {
    console.log(`Executing: ${args.query}`);
    // クエリ実行
    return { rowCount: 42 };
  },
  cleanup: async ({ args, error }) => {
    console.log("Closing database connection...");
    // DB接続を閉じる
    if (error) {
      console.error(`Error occurred: ${error.message}`);
    }
  },
});
```

### エラーハンドリング

`cleanup` はエラー発生時も実行されるため、確実なリソース解放が可能です。

```typescript
const command = defineCommand({
  name: "with-lock",
  args: z.object({
    resource: arg(z.string(), { positional: true }),
  }),
  setup: async ({ args }) => {
    console.log(`Acquiring lock on ${args.resource}...`);
    // ロックを取得
  },
  run: async ({ args }) => {
    console.log("Processing...");
    // エラーが発生してもcleanupは実行される
    throw new Error("Something went wrong!");
  },
  cleanup: async ({ args, error }) => {
    console.log(`Releasing lock on ${args.resource}...`);
    // ロックを解放（エラー時も確実に実行）
  },
});
```

## 実行結果の取得

`runMain` は実行結果を返します。

```typescript
const command = defineCommand({
  name: "calculate",
  args: z.object({
    a: arg(z.coerce.number(), { positional: true }),
    b: arg(z.coerce.number(), { positional: true }),
  }),
  run: ({ args }) => {
    return { sum: args.a + args.b, product: args.a * args.b };
  },
});

const result = await runMain(command, { argv: ["3", "4"] });
console.log(result.exitCode);  // 0
console.log(result.result);    // { sum: 7, product: 12 }
```

## テスト

`argv` オプションを使用してテストを書くことができます。

```typescript
import { describe, it, expect, vi } from "vitest";
import { defineCommand, runMain, arg } from "politty";
import { z } from "zod";

describe("my-cli", () => {
  it("should greet with name", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(msg));

    const command = defineCommand({
      args: z.object({
        name: arg(z.string(), { positional: true }),
      }),
      run: ({ args }) => {
        console.log(`Hello, ${args.name}!`);
      },
    });

    const result = await runMain(command, { argv: ["World"] });

    expect(result.exitCode).toBe(0);
    expect(logs).toContain("Hello, World!");
  });

  it("should return calculated result", async () => {
    const command = defineCommand({
      args: z.object({
        a: arg(z.coerce.number(), { positional: true }),
        b: arg(z.coerce.number(), { positional: true }),
      }),
      run: ({ args }) => args.a + args.b,
    });

    const result = await runMain(command, { argv: ["3", "5"] });

    expect(result.exitCode).toBe(0);
    expect(result.result).toBe(8);
  });

  it("should fail validation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const command = defineCommand({
      args: z.object({
        port: arg(z.coerce.number().min(1).max(65535), {
          alias: "p",
        }),
      }),
    });

    const result = await runMain(command, { argv: ["-p", "99999"] });

    expect(result.exitCode).toBe(1);
  });
});
```

## デバッグモード

`debug: true` を指定すると、エラー時にスタックトレースが表示されます。

```typescript
runMain(command, { debug: true });
```

```bash
$ my-cli --invalid
Error: Unknown option "--invalid"
    at parseArgs (/path/to/parser.js:42:11)
    at runMain (/path/to/runner.js:38:22)
    ...
```

## シグナルハンドリング

`handleSignals: true` を指定すると、SIGINT（Ctrl+C）やSIGTERMを処理できます。

```typescript
runMain(command, { handleSignals: true });
```

これにより、シグナル受信時にも `cleanup` フックが呼び出されます。
