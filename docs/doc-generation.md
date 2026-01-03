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

| Property         | Type                     | Description                                |
| ---------------- | ------------------------ | ------------------------------------------ |
| `command`        | `AnyCommand`             | ドキュメント生成対象のコマンド             |
| `files`          | `FileMapping`            | ファイルパスとコマンドのマッピング         |
| `ignores`        | `string[]`               | 除外するコマンドパス（サブコマンドも除外） |
| `format`         | `DefaultRendererOptions` | デフォルトレンダラーのオプション           |
| `formatter`      | `FormatterFunction`      | 生成内容のフォーマッター                   |
| `examples`       | `ExampleConfig`          | コマンドごとのexample実行設定              |
| `targetCommands` | `string[]`               | 特定コマンドのみを検証・生成（部分更新用） |

### `FileMapping`

ファイルパスをキーとして、含めるコマンドパスの配列を指定します。**指定したコマンドのサブコマンドは自動的に含まれます。**

```typescript
const files: FileMapping = {
  // ルートコマンドを指定すると全サブコマンドも含まれる
  "docs/cli.md": [""],

  // 複数ファイルに分割する場合
  "docs/cli.md": ["", "user"],
  "docs/cli/config.md": ["config"], // config get, config set も自動的に含まれる

  // ワイルドカードを使用
  "docs/config-commands.md": ["config *"], // config の直接の子コマンドのみ
};
```

- キーはファイルパス
- 値はコマンドパスの配列（`""`はルートコマンド、`"config get"`はスペース区切りのサブコマンドパス）
- **サブコマンドは自動的に含まれる**（`"config"` を指定すれば `"config get"`, `"config set"` も含まれる）
- **ワイルドカード `*`**: 任意の1つのコマンドセグメントにマッチ（下記参照）
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
- **ワイルドカード `*`**: 任意の1つのコマンドセグメントにマッチ（下記参照）
- `files` で指定したコマンドと `ignores` で指定したコマンドが重複するとエラー
- 存在しないコマンドパスを指定するとエラー

```typescript
// エラー: "config" が files と ignores の両方に指定されている
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["config"] },
  ignores: ["config"], // Error!
});
```

### ワイルドカードパターン

`files` と `ignores` でワイルドカード `*` を使用できます。`*` は任意の1つのコマンドセグメント（名前）にマッチします。

| パターン   | マッチ対象                 | 説明                                      |
| ---------- | -------------------------- | ----------------------------------------- |
| `*`        | `greet`, `config`          | 全トップレベルコマンド                    |
| `* *`      | `config get`, `config set` | 深さ2のコマンド（ネストしたサブコマンド） |
| `config *` | `config get`, `config set` | config の直接の子コマンド                 |
| `* * *`    | `config get key`           | 深さ3のコマンド                           |

**ワイルドカードでマッチしたコマンドのサブコマンドも自動的に対象になります**（通常のコマンドパス指定と同様）。

```typescript
// ネストしたサブコマンドのみを除外
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": [""] },
  ignores: ["* *"], // config get, config set など深さ2以上を除外
});

// 特定の親の子コマンドを別ファイルに
await assertDocMatch({
  command: cli,
  files: {
    "docs/cli.md": [""],
    "docs/config.md": ["config *"], // config get, config set のみ
  },
  ignores: ["config *"], // メインファイルから config の子を除外
});

// 全てのサブコマンドの "two" を除外
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["*"] }, // 全トップレベルコマンド
  ignores: ["* two"], // alpha two, beta two を除外
});
```

- ワイルドカードパターンがどのコマンドにもマッチしない場合はエラー

### `examples`

`defineCommand`で定義した`examples`を実際に実行し、出力をドキュメントに含めます。コマンドごとにモックを設定できます：

```typescript
import * as fs from "node:fs";
import { vi } from "vitest";

vi.mock("node:fs");

await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write"] },
  examples: {
    // read コマンド: ファイル読み込みをモック
    read: {
      mock: () => {
        vi.mocked(fs.readFileSync).mockImplementation((path) => {
          if (path === "config.json") return '{"name": "app"}';
          throw new Error(`File not found: ${path}`);
        });
      },
      cleanup: () => {
        vi.mocked(fs.readFileSync).mockReset();
      },
    },
    // write コマンド: ファイル書き込みをモック
    write: {
      mock: () => {
        vi.mocked(fs.writeFileSync).mockImplementation(() => {});
      },
      cleanup: () => {
        vi.mocked(fs.writeFileSync).mockReset();
      },
    },
  },
});
```

### `ExampleConfig`

| Property  | Type                          | Description                               |
| --------- | ----------------------------- | ----------------------------------------- |
| `mock`    | `() => void \| Promise<void>` | example実行前に呼ばれるモック設定関数     |
| `cleanup` | `() => void \| Promise<void>` | example実行後に呼ばれるクリーンアップ関数 |

- `examples`に指定したコマンドパスのexamplesが実行される
- 各コマンドの`mock`→examples実行→`cleanup`の順で処理される
- モックは各コマンド間で干渉しない（`cleanup`でリセット）

### `targetCommands`

特定のコマンドのセクションのみを検証・生成します。コマンドごとにテストを分離する際に使用します：

```typescript
// read コマンドのセクションのみを検証・生成
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write"] },
  targetCommands: ["read"],
  examples: {
    read: { mock: () => { /* ... */ }, cleanup: () => { /* ... */ } },
  },
});

// 複数のコマンドを同時に検証・生成
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write"] },
  targetCommands: ["read", "write"],
  examples: {
    read: { mock: () => { /* ... */ }, cleanup: () => { /* ... */ } },
    write: { mock: () => { /* ... */ }, cleanup: () => { /* ... */ } },
  },
});
```

- `targetCommands`を指定すると、それらのコマンドのセクションのみが生成・検証される
- **サブコマンドの再帰展開**: 指定したコマンドのサブコマンドも自動的に生成される
  - ただし`files`で明示的に指定されたコマンドは除外（個別に`targetCommands`で生成されるため）
- 他のコマンドのセクションは既存ファイルにあればそのまま維持
- セクションが存在しない場合は`files`で指定された順序の正しい位置に挿入
- ルートコマンドを指定する場合は空文字列`""`を使用
- 複数のファイルにまたがるコマンドも同時に指定可能

```typescript
// サブコマンド再帰展開の例
// cli: root -> read, write, check, delete (サブコマンド)
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": ["", "read", "write", "check"] },
  targetCommands: [""],  // ルートコマンドを指定
  examples: {},
});
// 結果:
// - "" (ルート) のセクションが生成される
// - "delete" のセクションも生成される（filesに明示指定されていないサブコマンド）
// - "read", "write", "check" は生成されない（filesに明示指定されているため個別のテストで生成）
```

### `initDocFile(config, fileSystem?)`

テスト開始時にドキュメントファイルを初期化（削除）します。`beforeAll`で呼び出すことで、skipしたテストのセクションが残らないようにできます：

```typescript
import { initDocFile } from "politty/docs";

const docConfig = {
  command,
  files: { "docs/cli.md": ["", "sub1", "sub2"] },
};

describe("my-cli", () => {
  beforeAll(() => {
    initDocFile(docConfig);  // files内の全ファイルを初期化
  });

  // 各コマンドのテスト...
});
```

- 第1引数は `{ files: ... }` を含むオブジェクト、または単一のファイルパス文字列
- `POLITTY_DOCS_UPDATE=true`の時のみファイルを削除
- 通常のテスト実行時は何もしない（既存ファイルを検証）
- fsをモックしている場合は、第2引数に`realFs`を渡す：

```typescript
const realFs = await vi.importActual<typeof fs>("node:fs");

beforeAll(() => {
  initDocFile(docConfig, realFs);
});
```

### `defineCommand`の`examples`フィールド

コマンド定義時に使用例を追加できます：

```typescript
const readCommand = defineCommand({
  name: "read",
  args: z.object({
    file: arg(z.string(), { positional: true }),
  }),
  examples: [
    { cmd: "config.json", desc: "Read a JSON config file" },
    { cmd: "data.txt -f text", desc: "Read a text file" },
  ],
  run: (args) => {
    const content = fs.readFileSync(args.file, "utf-8");
    console.log(content);
  },
});
```

生成されるMarkdown：

````markdown
**Examples**

**Read a JSON config file**

```bash
$ config.json
{"name": "app"}
```

**Read a text file**

```bash
$ data.txt -f text
Hello from data.txt
```
````

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

#### ヘッダーレベルの自動調整

サブコマンドのヘッダーレベルは、コマンドの深さに基づいて**ファイル内で相対的に**自動調整されます：

- ファイル内で最も浅いコマンドが `headingLevel` を使用
- より深いサブコマンドは順次レベルが下がる

```markdown
<!-- docs/cli.md: ルートコマンドを含む場合 -->
# my-cli          ← depth=1, headingLevel
## config         ← depth=2, headingLevel+1
### config get    ← depth=3, headingLevel+2

<!-- docs/config.md: サブコマンドのみの場合 -->
# config          ← depth=2 だが、このファイルでは最も浅いので headingLevel
## config get     ← depth=3, headingLevel+1
```

サブコマンドのタイトルはフルパスで表示されます（例: `config get`）。

### Custom Section Renderers

各セクションのレンダリングをカスタマイズできます。`render*` 関数はデフォルトのコンテンツを受け取り、最終的なコンテンツを返します：

```typescript
import { createCommandRenderer } from "politty/docs";

const customRenderer = createCommandRenderer({
  // オプションセクションの後にExamplesを追加
  renderOptions: (defaultContent, info) => `${defaultContent}

**Examples**

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

**Usage**

\`\`\`
${info.fullCommandPath}
\`\`\`
`.trim();
```

### `CommandInfo`

レンダー関数に渡されるコマンド情報：

| Property          | Type                                  | Description                                          |
| ----------------- | ------------------------------------- | ---------------------------------------------------- |
| `name`            | `string`                              | コマンド名                                           |
| `description`     | `string \| undefined`                 | コマンドの説明                                       |
| `fullCommandPath` | `string`                              | フルコマンドパス（例: `"my-cli config get"`）        |
| `commandPath`     | `string`                              | コマンドパス（例: `"config get"`、ルートは `""`）    |
| `depth`           | `number`                              | コマンドの深さ（ルート=1、サブコマンド=2、以下同様） |
| `positionalArgs`  | `ResolvedFieldMeta[]`                 | 位置引数の配列                                       |
| `options`         | `ResolvedFieldMeta[]`                 | オプション（非位置引数）の配列                       |
| `subCommands`     | `SubCommandInfo[]`                    | サブコマンド情報の配列                               |
| `extracted`       | `ExtractedFields \| null`             | スキーマから抽出されたフィールド情報                 |
| `command`         | `AnyCommand`                          | 元のコマンドオブジェクト                             |
| `filePath`        | `string \| undefined`                 | このコマンドが出力されるファイルパス                 |
| `fileMap`         | `Record<string, string> \| undefined` | コマンドパス→ファイルパスのマップ                    |

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

デフォルトレンダラーは以下の形式の Markdown を生成します。サブコマンドのタイトルはフルパスで表示され、ヘッダーレベルは深さに応じて自動調整されます：

````markdown
# command-name

Command description

**Usage**

```
command-name [options] <arg>
```

**Arguments**

| Argument | Description          | Required |
| -------- | -------------------- | -------- |
| `arg`    | Argument description | Yes      |

**Options**

| Option             | Alias | Description        | Default     |
| ------------------ | ----- | ------------------ | ----------- |
| `--option <VALUE>` | `-o`  | Option description | `"default"` |
| `--help`           | `-h`  | Show help          | -           |

**Commands**

| Command                     | Description            |
| --------------------------- | ---------------------- |
| [`subcommand`](#subcommand) | Subcommand description |

## subcommand

Subcommand description

**Usage**

```
command-name subcommand [options]
```

**Commands**

| Command                                   | Description                |
| ----------------------------------------- | -------------------------- |
| [`subcommand action`](#subcommand-action) | Nested subcommand          |

### subcommand action

Nested subcommand description

**Usage**

```
command-name subcommand action
```
````

## Environment Variables

| Variable              | Description                                        |
| --------------------- | -------------------------------------------------- |
| `POLITTY_DOCS_UPDATE` | `true` または `1` でドキュメント更新モードを有効化 |

## Example: Playground Tests

### シンプルな例

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

### コマンドごとにテストを分離する例

複数のサブコマンドがあり、各コマンドで異なるモックが必要な場合、`targetCommands`と`initDocFile`を使ってテストを分離できます：

```typescript
// playground/22-examples/index.test.ts
import * as fs from "node:fs";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { assertDocMatch, initDocFile, type GenerateDocConfig } from "politty/docs";
import { command, readCommand, writeCommand, checkCommand } from "./index.js";

vi.mock("node:fs");
const realFs = await vi.importActual<typeof fs>("node:fs");

const baseDocConfig: Omit<GenerateDocConfig, "examples" | "targetCommands"> = {
  command,
  files: { "playground/22-examples/README.md": ["", "read", "write", "check"] },
};

describe("22-examples", () => {
  // テスト開始時にドキュメントファイルを初期化（fsをモックしている場合はrealFsを渡す）
  beforeAll(() => {
    initDocFile(baseDocConfig, realFs);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    // realFsに委譲
    vi.mocked(fs.existsSync).mockImplementation((path) => realFs.existsSync(path));
    vi.mocked(fs.readFileSync).mockImplementation((path, opts) =>
      realFs.readFileSync(path, opts as fs.EncodingOption),
    );
    vi.mocked(fs.writeFileSync).mockImplementation((path, data, opts) =>
      realFs.writeFileSync(path, data, opts),
    );
  });

  describe("root command", () => {
    it("documentation", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: [""],  // ルートコマンド
        examples: {},
      });
    });
  });

  describe("read command", () => {
    it("reads file content", async () => {
      vi.mocked(fs.readFileSync).mockReturnValue("file content");
      // ... テスト
    });

    it("documentation", async () => {
      await assertDocMatch({
        ...baseDocConfig,
        targetCommands: ["read"],
        examples: {
          read: {
            mock: () => {
              vi.mocked(fs.readFileSync).mockImplementation((path) => {
                if (path === "config.json") return '{"name": "app"}';
                return realFs.readFileSync(path, "utf-8");
              });
            },
            cleanup: () => {
              vi.mocked(fs.readFileSync).mockImplementation((path, opts) =>
                realFs.readFileSync(path, opts as fs.EncodingOption),
              );
            },
          },
        },
      });
    });
  });

  describe("write command", () => {
    // ... 同様のパターン
  });
});
```

このパターンの利点：

- 各コマンドのモックが独立：`read`コマンドと`write`コマンドで異なるモック設定が可能
- テストのskipが反映：テストをskipすると、そのコマンドのセクションは生成されない
- 順序が保持：`files`で指定した順序でセクションが配置される
- 冪等性：何度実行しても同じ結果が得られる

## Exports

### Main API

- `assertDocMatch` - ゴールデンテストアサーション
- `generateDoc` - ドキュメント生成
- `initDocFile` - ドキュメントファイル初期化（更新モード時にファイルを削除）

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

### Renderers (Examples)

- `renderExamplesDefault` - Examplesセクションのデフォルトレンダラー

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
- `ExampleConfig` - example実行設定
- `ExampleCommandConfig` - コマンドごとのexample設定
- `ExampleExecutionResult` - example実行結果
- `FormatterFunction` - フォーマッター関数型
