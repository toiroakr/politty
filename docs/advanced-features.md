# Advanced Features

## サブコマンド

politty は Git スタイルのサブコマンドをサポートしており、無限にネストしたり遅延ロードしたりできます。

### サブコマンドの定義

`defineCommand` の `subCommands` プロパティを使用します。

```typescript
const init = defineCommand({
  name: "init",
  run: () => console.log("Initializing..."),
});

const build = defineCommand({
  name: "build",
  run: () => console.log("Building..."),
});

const cli = defineCommand({
  name: "app",
  subCommands: {
    init,
    build
  }
});
```

### 遅延ロード

大規模な CLI の場合、起動時間を短縮するためにサブコマンドを遅延ロードできます。コマンドを直接インポートする代わりに、動的インポート (`import()`) を使って返す非同期関数を提供します。

> **注意**: 遅延ロードの効果を得るには、必ず動的インポート (`import()`) を使用してください。
> ファイル先頭の静的インポート (`import { ... } from "..."`) は、ファイル読み込み時に即座にモジュールを解決するため、遅延ロードにはなりません。

```typescript
// ❌ 静的インポート - ファイル読み込み時に即座に解決される
import { heavyCommand } from "./commands/heavy.js";

const cli = defineCommand({
  subCommands: {
    // heavyCommand は既に読み込み済み
    heavy: async () => heavyCommand,
  }
});
```

```typescript
// ✅ 動的インポート - サブコマンド実行時に初めて読み込まれる
const cli = defineCommand({
  subCommands: {
    heavy: async () => {
      const { heavyCommand } = await import("./commands/heavy.js");
      return heavyCommand;
    }
  }
});
```

完全な例は `playground/21-lazy-subcommands.ts` を参照してください。

### ネストされたサブコマンド

サブコマンド自体も `subCommands` を持つことができます。

```typescript
const remoteAdd = defineCommand({ name: "add", /* ... */ });
const remoteRemove = defineCommand({ name: "remove", /* ... */ });

const remote = defineCommand({
  name: "remote",
  subCommands: {
    add: remoteAdd,
    rm: remoteRemove
  }
});

const cli = defineCommand({
  subCommands: { remote }
});
```

```bash
$ my-cli remote add origin https://github.com/...
```

## 複雑なスキーマ

### Discriminated Union（相互排他オプション）

相互に排他的な引数のセットを作成するには、`z.discriminatedUnion` を使用します。これは、ある「モード」引数によって、有効（かつ必須）な他の引数が変わるようなコマンドに最適です。

```typescript
const args = z.discriminatedUnion("mode", [
  // モード1: ファイル入力
  z.object({
    mode: z.literal("file"),
    path: arg(z.string(), { description: "入力ファイルパス" }),
  }).describe("ファイルから入力"),
  // モード2: URL入力
  z.object({
    mode: z.literal("url"),
    url: arg(z.string().url(), { description: "入力URL" }),
    method: arg(z.enum(["GET", "POST"]).default("GET")),
  }).describe("URLから入力"),
]).describe("入力モード");

const command = defineCommand({
  args,
  run: ({ args }) => {
    if (args.mode === "file") {
      // ここでは args.path が有効
      console.log("Reading file:", args.path);
    } else {
      // ここでは args.url が有効
      console.log("Fetching URL:", args.url);
    }
  }
});
```

#### 説明の設定

- **discriminatedUnion全体の`.describe()`**: discriminatorフィールド（この例では`--mode`）の説明として使用されます
- **各バリアントの`.describe()`**: ヘルプメッセージで各バリアントのセクションに表示されます

ヘルプテキストは自動的にバリアントごとにグループ化されて表示されます:

```
Options:
  --mode <file|url>           入力モード

When mode=file: ファイルから入力
    --path <PATH>             入力ファイルパス (required)

When mode=url: URLから入力
    --url <URL>               入力URL (required)
    --method <METHOD>         (default: "GET")
```

### Intersection（スキーマの合成）

`.and()` や `z.intersection()` を使ってスキーマを結合し、共通のオプションを再利用できます。

```typescript
const sharedOptions = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
  json: arg(z.boolean().default(false)),
});

const command = defineCommand({
  args: sharedOptions.and(z.object({
    input: arg(z.string(), { positional: true })
  })),
  run: ({ args }) => {
    // args は verbose, json, そして input を持ちます
  }
});
```

## 変換 (Transformations)

Zod の `transform` を使用して、ハンドラに渡る前に引数を加工できます。

```typescript
args: z.object({
  // カンマ区切りの文字列を配列に変換
  tags: arg(
    z.string().transform(val => val.split(",")),
    { description: "カンマ区切りのタグ" }
  )
})
```

## 付録: Zod グローバルレジストリの拡張

通常、メタデータは `arg()` 関数経由で管理しますが、Zod のグローバル型定義を拡張して `_def` に直接メタデータを保存することも可能です。

### Zod `.meta()` の使用

`politty/augment` をインポートすることで、Zod の標準 `.meta()` メソッドを使用して引数のメタデータを定義できるようになります。これにより `arg()` ヘルパーを使わずにスッキリとした定義が可能になります。

```typescript
import "politty/augment"; // 必須: .meta() の型拡張を有効化 (TypeScriptのみ)
import { z } from "zod";
import { defineCommand } from "politty";

const command = defineCommand({
  args: z.object({
    name: z.string().meta({
      positional: true,
      description: "User name",
    }),
    verbose: z.boolean().meta({
      alias: "v",
      description: "Verbose mode"
    }),
  }),
  run: ({ args }) => {
    // ...
  }
});
```

この機能は Zod の `GlobalMeta` インターフェースを拡張することで実現されています。
