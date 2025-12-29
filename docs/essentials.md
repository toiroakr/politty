# Essentials

このガイドでは、**politty** で CLI ツールを作成するために必要なコアコンセプトを解説します。

## 引数とオプション

politty は Zod スキーマを使用して、Positional 引数と名前付きオプション（フラグ）を単一のオブジェクト内で定義します。

### Positional 引数

Positional 引数は名前ではなく位置によって決まります。`arg()` オプションで `{ positional: true }` を指定します。

**重要なルール:** `z.object` 内での定義順序が、そのまま引数の順番になります。

### メタデータの定義方法

引数のメタデータ（説明、Positionalフラグ、エイリアスなど）を定義するには2つの方法があります。

1. **`arg()`**: スキーマをヘルパー関数でラップします。標準的な方法です。
2. **`.meta()`**: Zodスキーマに直接チェーンします。これを使用する場合、TypeScriptの型サポートのために `import "politty/augment";` が推奨されます。

```typescript
import "politty/augment"; // .meta() の型サポートに必要
import { defineCommand, arg } from "politty";
import { z } from "zod";

const command = defineCommand({
  args: z.object({
    // 方法1: arg() を使用
    source: arg(z.string(), {
      positional: true,
      description: "コピー元ファイル"
    }),

    // 方法2: .meta() を使用
    // import "politty/augment" が必要です
    destination: z.string().meta({
      positional: true,
      description: "コピー先ファイル"
    }),
  }),
  // ...
});
```

以下では主に `arg()` を使った例を示しますが、`.meta()` でも同様に記述可能です。

```bash
$ my-cli src.txt dest.txt
```

#### Positional 引数のルール

1.  **必須はオプションより前に**: オプション（任意）の Positional 引数の後に、必須の Positional 引数を定義することはできません。
    - ✅ `必須` → `任意`
    - ❌ `任意` → `必須`
2.  **配列は最後のみ**: 配列の Positional 引数（例: `z.array(z.string())`）は定義できますが、**必ず最後**にする必要があります。残りの引数をすべて受け取ります。
3.  **配列と任意の併用禁止**: 配列 Positional 引数を使用する場合、他のオプション（任意）Positional 引数と組み合わせることはできません（曖昧さを避けるため）。

### 名前付きオプション（フラグ）

`{ positional: true }` が指定されていない引数は、すべて名前付きオプション（フラグ）として扱われます。

```typescript
args: z.object({
  // --name="value"
  name: arg(z.string(), { description: "名前" }),

  // --verbose または -v (真偽値フラグ)
  verbose: arg(z.boolean().default(false), {
    alias: "v",
    description: "詳細ログを有効化"
  }),
})
```

- **真偽値フラグ**: 存在するだけで `true` として扱われます（例: `--verbose`）。
- **エイリアス**: `alias` を使って `-v` のような短縮形を定義できます。
- **デフォルト値**: Zod の `.default()` を使用してフォールバック値を設定できます。

### 配列オプション

`z.array()` を使用すると、同じオプションを複数回指定できるようになります。

```typescript
args: z.object({
  include: arg(z.array(z.string()), {
    alias: "i",
    description: "含めるファイル"
  })
})
```

```bash
$ my-cli --include file1.txt -i file2.txt
# args.include = ["file1.txt", "file2.txt"]
```

## バリデーションと型

politty は Zod 上に構築されているため、強力なバリデーション機能がそのまま使えます。

### 型変換（`z.coerce`）

コマンドライン引数はデフォルトでは文字列です。`z.coerce` を使うと自動的に型変換できます。

```typescript
args: z.object({
  // "123" を 数値の 123 に変換
  port: arg(z.coerce.number().default(3000)),

  // "2023-01-01" を Date オブジェクトに変換
  date: arg(z.coerce.date()),
})
```

### 高度なバリデーション

Zod の refine メソッドなども使用可能です。

```typescript
args: z.object({
  email: arg(z.string().email()),

  age: arg(z.coerce.number().min(18).max(100)),

  url: arg(z.string().url()),
})
```

バリデーションエラーは自動的に捕捉され、ユーザーに見やすい形式で表示されます。

## ライフサイクルフック

`defineCommand` は3つのライフサイクルフックをサポートしています：

1.  **`setup`**: メイン処理の前に実行されます。リソースの初期化（DB接続や設定読み込み）に便利です。
2.  **`run`**: コマンドのメイン処理です。
3.  **`cleanup`**: `run` の完了後に、**エラーが発生した場合でも**実行されます。接続の切断や一時ファイルの削除に最適です。

```typescript
const command = defineCommand({
  setup: async ({ args }) => {
    console.log("Setting up...");
  },
  run: async (args) => {
    console.log("Running...");
    // throw new Error("Oops"); // ここでエラーになっても cleanup は実行される
  },
  cleanup: async ({ args, error }) => {
    console.log("Cleaning up...");
    if (error) console.error("実行中にエラーが発生しました:", error);
  }
});
```

実行順序は常に `setup` → `run` → `cleanup` が保証されています。
