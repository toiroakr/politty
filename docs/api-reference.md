# APIリファレンス

politty が提供する関数と型の詳細なリファレンスです。

## 関数

### `defineCommand`

コマンドを定義します。

```typescript
function defineCommand<TArgsSchema, TResult>(config: {
  name: string;
  description?: string;
  args?: TArgsSchema;
  subCommands?: Record<string, Command | (() => Promise<Command>)>;
  setup?: (context: SetupContext<TArgs>) => void | Promise<void>;
  run?: (args: TArgs) => TResult | Promise<TResult>;
  cleanup?: (context: CleanupContext<TArgs>) => void | Promise<void>;
  notes?: string;
}): Command<TArgs, TResult>
```

#### パラメータ

| 名前     | 型       | 説明           |
| -------- | -------- | -------------- |
| `config` | `object` | コマンドの設定 |

**config のプロパティ:**

| プロパティ    | 型                                                          | 説明                                     |
| ------------- | ----------------------------------------------------------- | ---------------------------------------- |
| `name`        | `string`                                                    | コマンド名（必須）                       |
| `description` | `string`                                                    | コマンドの説明                           |
| `args`        | `TArgsSchema`                                               | 引数スキーマ（Zodスキーマ）              |
| `subCommands` | `Record<string, Command \| (() => Promise<Command>)>`       | サブコマンド（遅延読み込み対応）         |
| `setup`       | `(context: SetupContext<TArgs>) => void \| Promise<void>`   | 初期化フック                             |
| `run`         | `(args: TArgs) => TResult \| Promise<TResult>`              | メイン処理                               |
| `cleanup`     | `(context: CleanupContext<TArgs>) => void \| Promise<void>` | 終了フック                               |
| `notes`       | `string`                                                    | 追加の注釈（ヘルプとドキュメントに表示） |
| `examples`    | `Example[]`                                                 | 使用例（ヘルプとドキュメントに表示）     |

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
  /** 追加の注釈 */
  notes?: string;
  /** 使用例 */
  examples?: Example[];
}
```

---

### `Example`

コマンドの使用例を定義する型です。

```typescript
interface Example {
  /** コマンド引数（例: "config.json" や "--loud Alice"） */
  cmd: string;
  /** 使用例の説明 */
  desc: string;
  /** 期待される出力（ドキュメント用、省略可） */
  output?: string;
}
```

---

### `ArgMeta`

引数のメタデータの型です（union型）。

```typescript
type ArgMeta = RegularArgMeta | BuiltinOverrideArgMeta;
```

---

### `BaseArgMeta`

すべての引数タイプで共通のベースメタデータです。

```typescript
interface BaseArgMeta {
  /** 引数の説明 */
  description?: string;
  /** positional引数として扱う */
  positional?: boolean;
  /** ヘルプ表示用のプレースホルダー */
  placeholder?: string;
  /**
   * 環境変数名（単一または配列）。
   * 配列の場合、先頭の要素が優先されます。
   * CLI引数は常に環境変数より優先されます。
   */
  env?: string | string[];
}
```

---

### `RegularArgMeta`

通常の引数用メタデータです。

```typescript
interface RegularArgMeta extends BaseArgMeta {
  /** 短いエイリアス（例: 'v' で --verbose を -v として使用可能） */
  alias?: string;
}
```

---

### `BuiltinOverrideArgMeta`

組み込みエイリアス (-h, -H) をオーバーライドする場合のメタデータです。

```typescript
interface BuiltinOverrideArgMeta extends BaseArgMeta {
  /** オーバーライドする組み込みエイリアス ('h' または 'H') */
  alias: "h" | "H";
  /** 組み込みエイリアスをオーバーライドするには true が必須 */
  overrideBuiltinAlias: true;
}
```

---

### `Logger`

CLI出力用のロガーインターフェースです。

```typescript
interface Logger {
  /** 標準出力にメッセージを出力 */
  log(message: string): void;
  /** 標準エラー出力にメッセージを出力 */
  error(message: string): void;
}
```

---

### `MainOptions`

`runMain` に渡すオプションの型です。

```typescript
interface MainOptions {
  /** コマンドのバージョン */
  version?: string;
  /** デバッグモードを有効化（エラー時にスタックトレースを表示） */
  debug?: boolean;
  /** 実行中の console 出力をキャプチャ（デフォルト: false） */
  captureLogs?: boolean;
  /** コマンド定義のバリデーションをスキップ（本番環境でテスト済みの場合に有用） */
  skipValidation?: boolean;
  /** カスタムロガー（デフォルト: console） */
  logger?: Logger;
}
```

---

### `RunCommandOptions`

`runCommand` に渡すオプションの型です。

```typescript
interface RunCommandOptions {
  /** デバッグモードを有効化（エラー時にスタックトレースを表示） */
  debug?: boolean;
  /** 実行中の console 出力をキャプチャ（デフォルト: false） */
  captureLogs?: boolean;
  /** コマンド定義のバリデーションをスキップ（本番環境でテスト済みの場合に有用） */
  skipValidation?: boolean;
  /** カスタムロガー（デフォルト: console） */
  logger?: Logger;
}
```

---

### `RunResult`

コマンド実行結果の型です（discriminated union）。

```typescript
type RunResult<T> = RunResultSuccess<T> | RunResultFailure;
```

---

### `RunResultSuccess`

成功時の実行結果です。

```typescript
interface RunResultSuccess<T = unknown> {
  /** 成功を示す */
  success: true;
  /** run関数の戻り値 */
  result: T | undefined;
  /** エラー（成功時は存在しない） */
  error?: never;
  /** 終了コード（成功時は常に 0） */
  exitCode: 0;
  /** 実行中に収集されたログ */
  logs: CollectedLogs;
}
```

---

### `RunResultFailure`

失敗時の実行結果です。

```typescript
interface RunResultFailure {
  /** 失敗を示す */
  success: false;
  /** run関数の戻り値（失敗時は存在しない） */
  result?: never;
  /** 発生したエラー */
  error: Error;
  /** 終了コード（0以外） */
  exitCode: number;
  /** 実行中に収集されたログ */
  logs: CollectedLogs;
}
```

---

### `CollectedLogs`

実行中に収集されたログです。

```typescript
interface CollectedLogs {
  /** 記録されたすべてのログエントリ */
  entries: LogEntry[];
}
```

---

### `LogEntry`

単一のログエントリです。

```typescript
interface LogEntry {
  /** ログメッセージ */
  message: string;
  /** 記録された時刻 */
  timestamp: Date;
  /** ログレベル */
  level: LogLevel;
  /** 出力ストリーム */
  stream: LogStream;
}
```

---

### `LogLevel`

ログレベルの型です。

```typescript
type LogLevel = "log" | "info" | "debug" | "warn" | "error";
```

---

### `LogStream`

出力ストリームの型です。

```typescript
type LogStream = "stdout" | "stderr";
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
  /** 組み込みオプションのカスタム説明 */
  descriptions?: BuiltinOptionDescriptions;
  /** コマンド階層のコンテキスト */
  context?: CommandContext;
}
```

---

### `BuiltinOptionDescriptions`

組み込みオプションの説明をカスタマイズするための型です。

```typescript
interface BuiltinOptionDescriptions {
  /** --help オプションの説明 */
  help?: string;
  /** --help-all オプションの説明 */
  helpAll?: string;
  /** --version オプションの説明 */
  version?: string;
}
```

---

### `CommandContext`

コマンド階層のコンテキストです。

```typescript
interface CommandContext {
  /** フルコマンドパス（例: ["config", "get"]） */
  commandPath?: string[];
  /** ルートコマンド名 */
  rootName?: string;
  /** ルートコマンドのバージョン */
  rootVersion?: string;
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
  schemaType: "object" | "discriminatedUnion" | "union" | "xor" | "intersection";
  /** discriminatorキー（discriminatedUnionの場合） */
  discriminator?: string;
  /** バリアント（discriminatedUnionの場合） */
  variants?: Array<{
    discriminatorValue: string;
    fields: ResolvedFieldMeta[];
    description?: string;
  }>;
  /** オプション（unionの場合） */
  unionOptions?: ExtractedFields[];
  /** スキーマの説明 */
  description?: string;
}
```

---

### `ResolvedFieldMeta`

解決されたフィールドメタデータの型です。

```typescript
interface ResolvedFieldMeta {
  /** フィールド名（camelCase、スキーマ定義時の名前） */
  name: string;
  /** CLIオプション名（kebab-case、コマンドラインで使用） */
  cliName: string;
  /** 短いエイリアス */
  alias?: string;
  /** 説明 */
  description?: string;
  /** positional引数かどうか */
  positional: boolean;
  /** プレースホルダー */
  placeholder?: string;
  /** 環境変数名（単一または配列） */
  env?: string | string[];
  /** 必須かどうか */
  required: boolean;
  /** デフォルト値 */
  defaultValue?: unknown;
  /** 検出された型 */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** 元のZodスキーマ */
  schema: z.ZodType;
  /** 組み込みエイリアス (-h, -H) をオーバーライドする場合 true */
  overrideBuiltinAlias?: true;
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

### `DuplicateAliasError`

重複したエイリアスのエラーを表すエラークラスです。

```typescript
class DuplicateAliasError extends Error {
  name: "DuplicateAliasError";
}
```

---

### `DuplicateFieldError`

重複したフィールド名のエラーを表すエラークラスです。

```typescript
class DuplicateFieldError extends Error {
  name: "DuplicateFieldError";
}
```

---

### `ReservedAliasError`

予約済みエイリアス使用時のエラーを表すエラークラスです。

```typescript
class ReservedAliasError extends Error {
  name: "ReservedAliasError";
}
```

---

### `CommandValidationError`

コマンド定義のバリデーションエラーの型です。

```typescript
interface CommandValidationError {
  /** エラーの種類 */
  type: "positional" | "duplicateAlias" | "duplicateField" | "reservedAlias";
  /** エラーメッセージ */
  message: string;
}
```

---

### `CommandValidationResult`

コマンド定義のバリデーション結果の型です。

```typescript
type CommandValidationResult =
  | { success: true }
  | { success: false; errors: CommandValidationError[] };
```

---

## エクスポート一覧

```typescript
// Core
export { defineCommand } from "./core/command.js";
export { runMain, runCommand } from "./core/runner.js";
export { arg, type ArgMeta } from "./core/arg-registry.js";
export {
  extractFields,
  getUnknownKeysMode,
  toKebabCase,
  type ExtractedFields,
  type ResolvedFieldMeta,
  type UnknownKeysMode,
} from "./core/schema-extractor.js";

// Utilities
export {
  generateHelp,
  type BuiltinOptionDescriptions,
  type CommandContext,
  type HelpOptions,
} from "./output/help-generator.js";
export {
  isColorEnabled,
  logger,
  setColorEnabled,
  styles,
  symbols,
} from "./output/logger.js";

// Types
export type {
  AnyCommand,
  ArgsSchema,
  CleanupContext,
  CollectedLogs,
  Command,
  CommandBase,
  Example,
  LogEntry,
  Logger,
  LogLevel,
  LogStream,
  MainOptions,
  NonRunnableCommand,
  RunCommandOptions,
  RunnableCommand,
  RunResult,
  RunResultFailure,
  RunResultSuccess,
  SetupContext,
  SubCommandsRecord,
  SubCommandValue,
} from "./types.js";

// Command definition validation
export {
  DuplicateAliasError,
  DuplicateFieldError,
  formatCommandValidationErrors,
  PositionalConfigError,
  ReservedAliasError,
  validateCommand,
  validateDuplicateAliases,
  validateDuplicateFields,
  validatePositionalConfig,
  validateReservedAliases,
  type CommandValidationError,
  type CommandValidationResult,
} from "./validator/command-validator.js";

// Zod validation
export { formatValidationErrors } from "./validator/zod-validator.js";
export type { ValidationError, ValidationResult } from "./validator/zod-validator.js";
```
