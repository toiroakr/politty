# APIリファレンス

politty が提供する関数と型の詳細なリファレンスです。

## 関数

### `defineCommand`

コマンドを定義します。

```typescript
function defineCommand<TArgsSchema, TResult>(
  config: CommandConfig<TArgsSchema, TResult>
): Command<TArgs, TResult>
```

#### パラメータ

| 名前     | 型              | 説明           |
| -------- | --------------- | -------------- |
| `config` | `CommandConfig` | コマンドの設定 |

#### 使用例

```typescript
import { z } from "zod";
import { defineCommand, arg } from "politty";

const command = defineCommand({
  name: "my-cli",
  description: "CLIツールの説明",
  args: z.object({
    input: arg(z.string(), { positional: true }),
  }),
  setup: ({ args }) => { /* 初期化処理 */ },
  run: (args) => { /* メイン処理 */ },
  cleanup: ({ args, error }) => { /* 終了処理 */ },
});
```

---

### `runMain`

コマンドをCLIエントリポイントとして実行します。シグナルハンドリング（SIGINT, SIGTERM）が自動的に有効になり、終了時に `process.exit` を呼び出します。

```typescript
async function runMain(
  command: Command,
  options?: MainOptions
): Promise<never>
```

#### パラメータ

| 名前      | 型            | 説明                     |
| --------- | ------------- | ------------------------ |
| `command` | `Command`     | 実行するコマンド         |
| `options` | `MainOptions` | 実行オプション（省略可） |

#### 戻り値

`Promise<never>` - この関数は `process.exit` を呼び出すため、戻りません。

#### 使用例

```typescript
import { defineCommand, runMain } from "politty";

const command = defineCommand({
  name: "my-cli",
  run: () => console.log("Hello!")
});

// 基本的な使用
runMain(command);

// バージョン付き
runMain(command, { version: "1.0.0" });

// デバッグモード
runMain(command, { version: "1.0.0", debug: true });
```

---

### `runCommand`

コマンドをプログラマティックに実行します。テスト用途に最適です。`process.exit` を呼び出さず、シグナルハンドリングも行いません。

```typescript
async function runCommand<TResult>(
  command: Command,
  argv: string[],
  options?: RunCommandOptions
): Promise<RunResult<TResult>>
```

#### パラメータ

| 名前      | 型                  | 説明                     |
| --------- | ------------------- | ------------------------ |
| `command` | `Command`           | 実行するコマンド         |
| `argv`    | `string[]`          | コマンドライン引数       |
| `options` | `RunCommandOptions` | 実行オプション（省略可） |

#### 戻り値

`Promise<RunResult<TResult>>` - 実行結果

#### 使用例

```typescript
import { defineCommand, runCommand } from "politty";

const command = defineCommand({
  name: "my-cli",
  run: () => ({ success: true })
});

// テストでの使用
const result = await runCommand(command, ["--verbose", "input.txt"]);
console.log(result.exitCode);
console.log(result.result);
```

---

### `arg`

Zod スキーマにメタデータを付与します。

```typescript
function arg<T extends z.ZodType>(
  schema: T,
  meta: ArgMeta
): T
```

#### パラメータ

| 名前     | 型          | 説明             |
| -------- | ----------- | ---------------- |
| `schema` | `z.ZodType` | Zod スキーマ     |
| `meta`   | `ArgMeta`   | 引数のメタデータ |

#### 戻り値

同じ Zod スキーマ（チェーン可能）

#### 使用例

```typescript
import { z } from "zod";
import { arg } from "politty";

// positional引数
const input = arg(z.string(), {
  positional: true,
  description: "入力ファイル",
});

// エイリアス付きオプション
const verbose = arg(z.boolean().default(false), {
  alias: "v",
  description: "詳細出力",
});

// プレースホルダー付きオプション
const output = arg(z.string(), {
  alias: "o",
  description: "出力ファイル",
  placeholder: "FILE",  // ヘルプで --output <FILE> と表示
});
```

---

### `generateHelp`

コマンドのヘルプテキストを生成します。

```typescript
function generateHelp(
  command: Command,
  options: HelpOptions
): string
```

#### パラメータ

| 名前      | 型            | 説明                     |
| --------- | ------------- | ------------------------ |
| `command` | `Command`     | ヘルプを生成するコマンド |
| `options` | `HelpOptions` | ヘルプ生成オプション     |

#### 戻り値

フォーマットされたヘルプテキスト

---

### `extractFields`

スキーマからフィールド情報を抽出します。

```typescript
function extractFields(schema: ArgsSchema): ExtractedFields
```

#### 使用例

```typescript
import { z } from "zod";
import { extractFields, arg } from "politty";

const schema = z.object({
  name: arg(z.string(), { positional: true }),
  verbose: arg(z.boolean().default(false), { alias: "v" }),
});

const extracted = extractFields(schema);
// extracted.fields には各フィールドの情報が含まれる
```

---

### `validatePositionalConfig`

positional引数の設定が有効かどうかを検証します。

```typescript
function validatePositionalConfig(extracted: ExtractedFields): void
```

無効な設定の場合、`PositionalConfigError` をスローします。

---

### `formatValidationErrors`

バリデーションエラーをユーザーフレンドリーな文字列にフォーマットします。

```typescript
function formatValidationErrors(errors: ValidationError[]): string
```

---

## 型

### `CommandConfig`

`defineCommand` に渡す設定オブジェクトの型です。

```typescript
interface CommandConfig<TArgsSchema, TResult> {
  /** コマンド名（必須） */
  name: string;
  /** 説明 */
  description?: string;
  /** 引数スキーマ */
  args?: TArgsSchema;
  /** サブコマンド */
  subCommands?: Record<string, Command | (() => Promise<Command>)>;
  /** 初期化フック */
  setup?: (context: SetupContext<TArgs>) => void | Promise<void>;
  /** メイン処理 */
  run?: (args: TArgs) => TResult | Promise<TResult>;
  /** 終了フック */
  cleanup?: (context: CleanupContext<TArgs>) => void | Promise<void>;
}
```

---

### `Command`

定義されたコマンドの型です。

```typescript
interface Command<TArgs, TResult> {
  /** コマンド名（必須） */
  name: string;
  description?: string;
  argsSchema?: ArgsSchema;
  subCommands?: Record<string, Command | (() => Promise<Command>)>;
  setup?: (context: SetupContext<TArgs>) => void | Promise<void>;
  run?: (args: TArgs) => TResult | Promise<TResult>;
  cleanup?: (context: CleanupContext<TArgs>) => void | Promise<void>;
}
```

---

### `ArgMeta`

引数のメタデータの型です。

```typescript
interface ArgMeta {
  /** 短いエイリアス（例: 'v' で --verbose を -v として使用可能） */
  alias?: string;
  /** 引数の説明 */
  description?: string;
  /** positional引数として扱う */
  positional?: boolean;
  /** ヘルプ表示用のプレースホルダー */
  placeholder?: string;
}
```

---

### `MainOptions`

`runMain` に渡すオプションの型です。

```typescript
interface MainOptions {
  /** コマンドのバージョン */
  version?: string;
  /** デバッグモードを有効化 */
  debug?: boolean;
}
```

---

### `RunCommandOptions`

`runCommand` に渡すオプションの型です。

```typescript
interface RunCommandOptions {
  /** デバッグモードを有効化 */
  debug?: boolean;
}
```

---

### `RunResult`

コマンド実行結果の型です。

```typescript
interface RunResult<T> {
  /** run関数の戻り値 */
  result?: T;
  /** 終了コード */
  exitCode: number;
}
```

---

### `SetupContext`

`setup` フックに渡されるコンテキストの型です。

```typescript
interface SetupContext<TArgs> {
  /** パース・バリデーション済みの引数 */
  args: TArgs;
}
```

---

### `CleanupContext`

`cleanup` フックに渡されるコンテキストの型です。

```typescript
interface CleanupContext<TArgs> {
  /** パース・バリデーション済みの引数 */
  args: TArgs;
  /** 実行中に発生したエラー（あれば） */
  error?: Error;
}
```

> **Note:** `run` 関数はコンテキストオブジェクトではなく、パース済みの引数 `args` を直接受け取ります。

---

### `HelpOptions`

`generateHelp` に渡すオプションの型です。

```typescript
interface HelpOptions {
  /** サブコマンド一覧を表示 */
  showSubcommands?: boolean;
  /** サブコマンドのオプションを表示 */
  showSubcommandOptions?: boolean;
}
```

---

### `ExtractedFields`

スキーマから抽出されたフィールド情報の型です。

```typescript
interface ExtractedFields {
  /** 全フィールド定義 */
  fields: ResolvedFieldMeta[];
  /** 元のスキーマ */
  schema: ArgsSchema;
  /** スキーマの種類 */
  schemaType: "object" | "discriminatedUnion" | "union" | "intersection";
  /** discriminatorキー（discriminatedUnionの場合） */
  discriminator?: string;
  /** バリアント（discriminatedUnionの場合） */
  variants?: Array<{
    discriminatorValue: string;
    fields: ResolvedFieldMeta[];
    description?: string;
  }>;
}
```

---

### `ResolvedFieldMeta`

解決されたフィールドメタデータの型です。

```typescript
interface ResolvedFieldMeta {
  /** フィールド名 */
  name: string;
  /** 短いエイリアス */
  alias?: string;
  /** 説明 */
  description?: string;
  /** positional引数かどうか */
  positional: boolean;
  /** プレースホルダー */
  placeholder?: string;
  /** 必須かどうか */
  required: boolean;
  /** デフォルト値 */
  defaultValue?: unknown;
  /** 検出された型 */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** 元のZodスキーマ */
  schema: z.ZodType;
}
```

---

### `ValidationError`

バリデーションエラーの型です。

```typescript
interface ValidationError {
  /** エラーが発生したパス */
  path: (string | number)[];
  /** エラーメッセージ */
  message: string;
}
```

---

### `ValidationResult`

バリデーション結果の型です。

```typescript
type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };
```

---

### `PositionalConfigError`

positional引数の設定エラーを表すエラークラスです。

```typescript
class PositionalConfigError extends Error {
  name: "PositionalConfigError";
}
```

---

## エクスポート一覧

```typescript
// Core
export { defineCommand } from "./core/command.js";
export { runMain, runCommand } from "./core/runner.js";
export { arg, type ArgMeta } from "./core/arg-registry.js";

// Utilities
export { generateHelp, type HelpOptions } from "./output/help-generator.js";
export {
  extractFields,
  validatePositionalConfig,
  PositionalConfigError,
  type ExtractedFields,
  type ResolvedFieldMeta,
} from "./core/schema-extractor.js";

// Types
export type {
  Command,
  AnyCommand,
  CommandConfig,
  ArgsSchema,
  SetupContext,
  CleanupContext,
  MainOptions,
  RunCommandOptions,
  RunResult,
} from "./types.js";

// Validation
export type { ValidationError, ValidationResult } from "./validator/zod-validator.js";
export { formatValidationErrors } from "./validator/zod-validator.js";
```
