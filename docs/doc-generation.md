# Documentation Generator

`defineCommand`で定義した CLI コマンドから Markdown ドキュメントを自動生成し、ゴールデンテストで整合性を検証するシステム。

## Quick Start

```typescript
import { describe, it } from "vitest";
import { assertDocMatch } from "politty/docs";
import { command } from "./my-command.js";

describe("my-command", () => {
  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "path/to/README.md": [""] },
    });
  });
});
```

### ドキュメント更新

差分があるとテストが失敗します。環境変数を設定してテストを実行するとファイルが更新されます：

```bash
POLITTY_DOCS_UPDATE=true pnpm test
```

## API

### `assertDocMatch(config)`

ドキュメントがゴールデンファイルと一致するかを検証します。差分があり、かつ`POLITTY_DOCS_UPDATE`が設定されていない場合はエラーをスローします。

```typescript
import { assertDocMatch } from "politty/docs";

await assertDocMatch({
  command: myCommand,
  files: {
    "docs/cli.md": [""], // ルートコマンドのみ
  },
});
```

### `generateDoc(config)`

ドキュメントを生成し、結果を返します。アサーションは行いません。

```typescript
import { generateDoc } from "politty/docs";

const result = await generateDoc({
  command: myCommand,
  files: { "docs/cli.md": [""] },
});

console.log(result.success); // true or false
console.log(result.files); // 各ファイルのステータス
```

## Configuration

### `GenerateDocConfig`

| Property  | Type                     | Description                                |
| --------- | ------------------------ | ------------------------------------------ |
| `command` | `AnyCommand`             | ドキュメント生成対象のコマンド             |
| `files`   | `FileMapping`            | ファイルパスとコマンドのマッピング         |
| `ignores` | `string[]`               | 除外するコマンドパス（サブコマンドも除外） |
| `format`  | `DefaultRendererOptions` | デフォルトレンダラーのオプション           |
| `version` | `string`                 | ドキュメントに含めるバージョン文字列       |

### `FileMapping`

ファイルパスをキーとして、含めるコマンドパスの配列を指定します。**指定したコマンドのサブコマンドは自動的に含まれます。**

```typescript
const files: FileMapping = {
  // ルートコマンドを指定すると全サブコマンドも含まれる
  "docs/cli.md": [""],

  // 複数ファイルに分割する場合
  "docs/cli.md": ["", "user"],
  "docs/cli/config.md": ["config"], // config get, config set も自動的に含まれる
};
```

- キーはファイルパス
- 値はコマンドパスの配列（`""`はルートコマンド、`"config get"`はスペース区切りのサブコマンドパス）
- **サブコマンドは自動的に含まれる**（`"config"` を指定すれば `"config get"`, `"config set"` も含まれる）
- 値として `FileConfig` オブジェクトを渡すとカスタムレンダラーを指定可能
- **別ファイルへのリンク**: サブコマンドが別ファイルに出力される場合、自動的に相対パスでリンクが生成される

```typescript
// 例: config サブコマンドを別ファイルに分割
const files: FileMapping = {
  "docs/cli.md": [""],              // config へのリンクが config.md#config になる
  "docs/config.md": ["config"],     // config get, config set は同一ファイル内アンカー
};
```

### `FileConfig`

```typescript
interface FileConfig {
  commands: string[]; // 含めるコマンドパスの配列
  render?: RenderFunction; // カスタムレンダラー（省略可）
}
```

### `ignores`

特定のコマンドとそのサブコマンドをドキュメント生成から除外します：

```typescript
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  ignores: ["internal", "debug"], // internal, debug とそのサブコマンドを除外
});
```

- `ignores` に指定したコマンドとそのサブコマンドは自動的に除外される
- `files` で指定したコマンドと `ignores` で指定したコマンドが重複するとエラー

```typescript
// エラー: "config" が files と ignores の両方に指定されている
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["config"] },
  ignores: ["config"], // Error!
});
```

## Customization

### Default Renderer Options

デフォルトレンダラーの出力をカスタマイズできます：

```typescript
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  format: {
    headingLevel: 2, // 見出しレベル（デフォルト: 1）
    optionStyle: "list", // "table" or "list"
    generateAnchors: true, // サブコマンドへのアンカーリンク
    includeSubcommandDetails: true, // サブコマンド詳細を含める
  },
});
```

### Custom Section Renderers

各セクションのレンダリングをカスタマイズできます。`render*` 関数はデフォルトのコンテンツを受け取り、最終的なコンテンツを返します：

```typescript
import { createCommandRenderer } from "politty/docs";

const customRenderer = createCommandRenderer({
  // オプションセクションの後にExamplesを追加
  renderOptions: (defaultContent, info) => `${defaultContent}

## Examples

\`\`\`bash
${info.fullCommandPath} --help
\`\`\``,
});

await assertDocMatch({
  command: cli,
  files: {
    "docs/cli.md": { commands: [""], render: customRenderer },
  },
});
```

セクションを非表示にする場合は空文字列を返します：

```typescript
const customRenderer = createCommandRenderer({
  renderArguments: () => "", // 引数セクションを非表示
});
```

利用可能なレンダー関数：

- `renderDescription` - 説明セクション
- `renderUsage` - Usage セクション
- `renderArguments` - 引数セクション
- `renderOptions` - オプションセクション
- `renderSubcommands` - サブコマンドセクション
- `renderFooter` - フッター（デフォルトは空）

### Fully Custom Renderer

完全にカスタムな Markdown を生成することもできます：

```typescript
import type { RenderFunction, CommandInfo } from "politty/docs";

const myRenderer: RenderFunction = (info: CommandInfo) => `
# ${info.name}

${info.description ?? ""}

## Usage

\`\`\`
${info.fullCommandPath}
\`\`\`
`.trim();
```

### `CommandInfo`

レンダー関数に渡されるコマンド情報：

| Property          | Type                                  | Description                                   |
| ----------------- | ------------------------------------- | --------------------------------------------- |
| `name`            | `string`                              | コマンド名                                    |
| `description`     | `string \| undefined`                 | コマンドの説明                                |
| `fullCommandPath` | `string`                              | フルコマンドパス（例: `"my-cli config get"`） |
| `commandPath`     | `string[]`                            | コマンドパス配列（例: `["config", "get"]`）   |
| `rootName`        | `string`                              | ルートコマンド名                              |
| `positionalArgs`  | `ResolvedFieldMeta[]`                 | 位置引数の配列                                |
| `options`         | `ResolvedFieldMeta[]`                 | オプション（非位置引数）の配列                |
| `subCommands`     | `SubCommandInfo[]`                    | サブコマンド情報の配列                        |
| `extracted`       | `ExtractedFields \| null`             | スキーマから抽出されたフィールド情報          |
| `command`         | `AnyCommand`                          | 元のコマンドオブジェクト                      |
| `filePath`        | `string \| undefined`                 | このコマンドが出力されるファイルパス          |
| `fileMap`         | `Record<string, string> \| undefined` | コマンドパス→ファイルパスのマップ             |

### `SubCommandInfo`

サブコマンド情報：

| Property       | Type                  | Description          |
| -------------- | --------------------- | -------------------- |
| `name`         | `string`              | サブコマンド名       |
| `description`  | `string \| undefined` | サブコマンドの説明   |
| `relativePath` | `string[]`            | 親からの相対パス     |
| `fullPath`     | `string[]`            | フルコマンドパス配列 |

### `ResolvedFieldMeta`

引数・オプションのメタ情報：

| Property       | Type                  | Description                         |
| -------------- | --------------------- | ----------------------------------- |
| `name`         | `string`              | フィールド名                        |
| `description`  | `string \| undefined` | 説明                                |
| `alias`        | `string \| undefined` | 短縮エイリアス（例: `"v"`）         |
| `type`         | `string`              | 型（`"string"`, `"boolean"`, etc.） |
| `required`     | `boolean`             | 必須かどうか                        |
| `defaultValue` | `unknown`             | デフォルト値                        |
| `positional`   | `boolean`             | 位置引数かどうか                    |
| `placeholder`  | `string \| undefined` | プレースホルダー（例: `"FILE"`）    |

## Generated Markdown Format

デフォルトレンダラーは以下の形式の Markdown を生成します：

````markdown
# command-name

Command description

## Usage

```
command-name [options] <arg>
```

## Arguments

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `arg`    | Argument description | Yes      |

## Options

| Option             | Alias | Description        | Default     |
| ------------------ | ----- | ------------------ | ----------- |
| `--option <VALUE>` | `-o`  | Option description | `"default"` |
| `--help`           | `-h`  | Show help          | -           |

## Commands

| Command                     | Description            |
| --------------------------- | ---------------------- |
| [`subcommand`](#subcommand) | Subcommand description |
````

## Environment Variables

| Variable              | Description                                        |
| --------------------- | -------------------------------------------------- |
| `POLITTY_DOCS_UPDATE` | `true` または `1` でドキュメント更新モードを有効化 |

## Example: Playground Tests

各 playground コマンドでドキュメントテストを実装している例：

```typescript
// playground/01-hello-world/index.test.ts
import { describe, it } from "vitest";
import { assertDocMatch } from "../../src/docs/index.js";
import { command } from "./index.js";

describe("01-hello-world", () => {
  // ... other tests ...

  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "playground/01-hello-world/README.md": [""] },
    });
  });
});
```

## Exports

### Main API

- `assertDocMatch` - ゴールデンテストアサーション
- `generateDoc` - ドキュメント生成

### Utilities

- `buildCommandInfo` - コマンド情報の構築
- `collectAllCommands` - 全コマンドの収集
- `resolveSubcommand` - lazy サブコマンドの解決

### Renderers

- `createCommandRenderer` - カスタムレンダラー作成
- `defaultRenderers` - デフォルトレンダラープリセット
- `renderUsage` - Usage 生成
- `renderArgumentsTable` / `renderArgumentsList` - 引数レンダリング
- `renderOptionsTable` / `renderOptionsList` - オプションレンダリング
- `renderSubcommandsTable` - サブコマンドレンダリング

### Comparator

- `compareWithExisting` - ファイル比較
- `formatDiff` - 差分フォーマット
- `writeFile` - ファイル書き込み

### Types

- `CommandInfo` - コマンド情報
- `SubCommandInfo` - サブコマンド情報
- `RenderFunction` - レンダラー関数型
- `SectionRenderFunction` - セクションレンダー関数型
- `DefaultRendererOptions` - レンダラーオプション
- `FileConfig` - ファイル設定
- `FileMapping` - ファイルマッピング
- `GenerateDocConfig` - 設定
- `GenerateDocResult` - 結果
