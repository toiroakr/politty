# Positional引数

Positional引数は、コマンドラインでフラグなしに位置によって指定される引数です。
このドキュメントでは、positional引数の定義方法とルールについて詳しく説明します。

## 基本的な使い方

`positional: true` を指定することで、引数をpositional引数として定義できます。

```typescript
import { z } from "zod";
import { defineCommand, arg } from "politty";

const command = defineCommand({
  args: z.object({
    source: arg(z.string(), {
      positional: true,
      description: "コピー元ファイル",
    }),
    destination: arg(z.string(), {
      positional: true,
      description: "コピー先ファイル",
    }),
  }),
  run: ({ args }) => {
    console.log(`Copying ${args.source} to ${args.destination}`);
  },
});
```

```bash
$ my-cli source.txt dest.txt
Copying source.txt to dest.txt
```

## 定義順序

Positional引数は**オブジェクトで定義した順序**で割り当てられます。

```typescript
args: z.object({
  first: arg(z.string(), { positional: true }),   // 1番目の引数
  second: arg(z.string(), { positional: true }),  // 2番目の引数
  third: arg(z.string(), { positional: true }),   // 3番目の引数
})
```

```bash
$ my-cli a b c
# args.first = "a"
# args.second = "b"
# args.third = "c"
```

## 必須とオプション

### 必須のpositional引数

デフォルトでは、positional引数は必須です。

```typescript
args: z.object({
  input: arg(z.string(), { positional: true }),
})
```

### オプションのpositional引数

`.optional()` または `.default()` を使用してオプションにできます。

```typescript
args: z.object({
  input: arg(z.string(), { positional: true }),
  output: arg(z.string().optional(), { positional: true }),
})
```

```bash
$ my-cli input.txt
# args.input = "input.txt"
# args.output = undefined

$ my-cli input.txt output.txt
# args.input = "input.txt"
# args.output = "output.txt"
```

### デフォルト値付きのpositional引数

```typescript
args: z.object({
  input: arg(z.string(), { positional: true }),
  output: arg(z.string().default("output.txt"), { positional: true }),
})
```

```bash
$ my-cli input.txt
# args.input = "input.txt"
# args.output = "output.txt"  # デフォルト値が使用される
```

## 配列positional引数

残りの全ての引数を配列として受け取ることができます。

```typescript
args: z.object({
  command: arg(z.string(), { positional: true }),
  files: arg(z.array(z.string()), { positional: true }),
})
```

```bash
$ my-cli build src/a.ts src/b.ts src/c.ts
# args.command = "build"
# args.files = ["src/a.ts", "src/b.ts", "src/c.ts"]
```

## 定義ルール

Positional引数の定義には以下のルールがあります。
これらに違反すると `PositionalConfigError` がスローされます。

### ルール1: 必須 → オプション の順序

必須のpositional引数は、オプションのpositional引数より**前**に定義する必要があります。

```typescript
// ✅ 正しい: 必須 → オプション
args: z.object({
  input: arg(z.string(), { positional: true }),           // 必須
  output: arg(z.string().optional(), { positional: true }), // オプション
})

// ❌ エラー: オプション → 必須
args: z.object({
  config: arg(z.string().optional(), { positional: true }), // オプション
  input: arg(z.string(), { positional: true }),             // 必須 → エラー!
})
```

**理由**: オプション引数の後に必須引数があると、パースが曖昧になります。
例えば `["a"]` という入力があった場合、`"a"` がオプション引数なのか必須引数なのか判断できません。

### ルール2: 配列positionalは最後のみ

配列positional引数は、positional引数の中で**最後**に定義する必要があります。
配列positionalの後に他のpositional引数を定義することはできません。

```typescript
// ✅ 正しい: 必須 → 配列
args: z.object({
  command: arg(z.string(), { positional: true }),
  files: arg(z.array(z.string()), { positional: true }),
})

// ❌ エラー: 配列 → 他のpositional
args: z.object({
  files: arg(z.array(z.string()), { positional: true }),
  output: arg(z.string(), { positional: true }),  // エラー!
})
```

**理由**: 配列positional引数は残りの全ての引数を消費するため、
その後に他のpositional引数があっても値を受け取れません。

### ルール3: 配列とオプションは併用不可

配列positional引数とオプションのpositional引数を同時に使用することはできません。

```typescript
// ✅ 正しい: 必須のみ + 配列
args: z.object({
  command: arg(z.string(), { positional: true }),
  files: arg(z.array(z.string()), { positional: true }),
})

// ❌ エラー: オプション + 配列
args: z.object({
  mode: arg(z.string().optional(), { positional: true }),
  files: arg(z.array(z.string()), { positional: true }),  // エラー!
})

// ❌ エラー: デフォルト値付き + 配列
args: z.object({
  mode: arg(z.string().default("build"), { positional: true }),
  files: arg(z.array(z.string()), { positional: true }),  // エラー!
})
```

**理由**: オプションのpositional引数と配列positional引数が同時に存在すると、
どこまでがオプション引数でどこからが配列なのか判断できません。

例: `["a", "b", "c"]` という入力があった場合

- `"a"` は `mode` に入る? それとも `files` の最初の要素?
- この曖昧さを避けるため、この組み合わせは禁止されています。

## 許可されるパターン一覧

| パターン          | 可否 | 例                   |
| ----------------- | ---- | -------------------- |
| 必須のみ          | ✅   | `required, required` |
| 必須 → オプション | ✅   | `required, optional` |
| 必須 → 配列       | ✅   | `required, array`    |
| オプションのみ    | ✅   | `optional, optional` |
| 配列のみ          | ✅   | `array`              |
| オプション → 必須 | ❌   | パース曖昧           |
| 配列 → 任意       | ❌   | 配列が全消費         |
| オプション + 配列 | ❌   | パース曖昧           |

## 実践的な例

### cpコマンド風

```typescript
const cp = defineCommand({
  name: "cp",
  args: z.object({
    source: arg(z.string(), {
      positional: true,
      description: "コピー元",
    }),
    destination: arg(z.string(), {
      positional: true,
      description: "コピー先",
    }),
    recursive: arg(z.boolean().default(false), {
      alias: "r",
      description: "ディレクトリを再帰的にコピー",
    }),
  }),
  run: ({ args }) => {
    console.log(`Copying ${args.source} to ${args.destination}`);
  },
});
```

### gccコマンド風

```typescript
const gcc = defineCommand({
  name: "gcc",
  args: z.object({
    output: arg(z.string(), {
      alias: "o",
      description: "出力ファイル名",
    }),
    sources: arg(z.array(z.string()), {
      positional: true,
      description: "ソースファイル",
    }),
  }),
  run: ({ args }) => {
    console.log(`Compiling ${args.sources.join(", ")} -> ${args.output}`);
  },
});
```

```bash
$ gcc -o app main.c util.c lib.c
Compiling main.c, util.c, lib.c -> app
```

### catコマンド風

```typescript
const cat = defineCommand({
  name: "cat",
  args: z.object({
    files: arg(z.array(z.string()), {
      positional: true,
      description: "表示するファイル",
    }),
    number: arg(z.boolean().default(false), {
      alias: "n",
      description: "行番号を表示",
    }),
  }),
  run: ({ args }) => {
    for (const file of args.files) {
      console.log(`Contents of ${file}:`);
      // ...
    }
  },
});
```

```bash
$ cat file1.txt file2.txt file3.txt
```

### オプション引数付き

```typescript
const convert = defineCommand({
  name: "convert",
  args: z.object({
    input: arg(z.string(), {
      positional: true,
      description: "入力ファイル",
    }),
    output: arg(z.string().optional(), {
      positional: true,
      description: "出力ファイル（省略時は標準出力）",
    }),
    format: arg(z.enum(["json", "yaml", "toml"]).default("json"), {
      alias: "f",
      description: "出力形式",
    }),
  }),
  run: ({ args }) => {
    const dest = args.output ?? "stdout";
    console.log(`Converting ${args.input} to ${dest} as ${args.format}`);
  },
});
```

```bash
$ convert input.json
Converting input.json to stdout as json

$ convert input.json output.yaml -f yaml
Converting input.json to output.yaml as yaml
```

## エラーメッセージ

ルールに違反した場合、以下のようなエラーメッセージが表示されます。

### オプション → 必須 の場合

```
Error: Required positional argument "input" cannot follow optional positional argument "config".
Optional positional arguments must come after all required positionals.
```

### 配列の後にpositionalがある場合

```
Error: Positional argument "output" cannot follow array positional argument "files".
Array positional arguments must be the last positional.
```

### オプション + 配列 の場合

```
Error: Array positional argument "files" cannot be used with optional positional argument "mode".
This combination creates ambiguous parsing.
```
