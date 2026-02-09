# API Reference

Detailed reference for functions and types provided by politty.

## Functions

### `defineCommand`

Defines a command.

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
}): Command<TArgs, TResult>;
```

#### Parameters

| Name     | Type     | Description           |
| -------- | -------- | --------------------- |
| `config` | `object` | Command configuration |

**config properties:**

| Property      | Type                                                        | Description                               |
| ------------- | ----------------------------------------------------------- | ----------------------------------------- |
| `name`        | `string`                                                    | Command name (required)                   |
| `description` | `string`                                                    | Command description                       |
| `args`        | `TArgsSchema`                                               | Argument schema (Zod schema)              |
| `subCommands` | `Record<string, Command \| (() => Promise<Command>)>`       | Subcommands (supports lazy loading)       |
| `setup`       | `(context: SetupContext<TArgs>) => void \| Promise<void>`   | Initialization hook                       |
| `run`         | `(args: TArgs) => TResult \| Promise<TResult>`              | Main process                              |
| `cleanup`     | `(context: CleanupContext<TArgs>) => void \| Promise<void>` | Cleanup hook                              |
| `notes`       | `string`                                                    | Additional notes (shown in help and docs) |
| `examples`    | `Example[]`                                                 | Usage examples (shown in help and docs)   |

#### Example

```typescript
import { z } from "zod";
import { defineCommand, arg } from "politty";

const command = defineCommand({
  name: "my-cli",
  description: "CLI tool description",
  args: z.object({
    input: arg(z.string(), { positional: true }),
  }),
  setup: ({ args }) => {
    /* initialization */
  },
  run: (args) => {
    /* main process */
  },
  cleanup: ({ args, error }) => {
    /* cleanup */
  },
});
```

---

### `createDefineCommand` (Recommended for Global Options)

Creates a `defineCommand` function with global args type pre-applied. This is the recommended approach for type-safe global options access across multiple command definitions.

```typescript
function createDefineCommand<TGlobalArgs>(): typeof defineCommand;
```

#### Type Parameters

| Name          | Description                       |
| ------------- | --------------------------------- |
| `TGlobalArgs` | Type of global arguments to merge |

#### Return Value

A `defineCommand` function with `TGlobalArgs` pre-applied to the third type parameter.

#### Example

```typescript
import { z } from "zod";
import { arg, createDefineCommand } from "politty";

// Define global args schema and type
const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
  config: arg(z.string().optional(), { alias: "c" }),
});
type GlobalArgsType = z.infer<typeof globalArgsSchema>;

// Create a project-specific defineCommand
const defineAppCommand = createDefineCommand<GlobalArgsType>();

// Use it without repeating type parameters
const buildCommand = defineAppCommand({
  name: "build",
  args: z.object({
    output: arg(z.string().default("dist")),
  }),
  run: (args) => {
    // args.verbose is typed automatically
    if (args.verbose) {
      console.log("Verbose mode enabled");
    }
  },
});
```

---

### `runMain`

Executes a command as the CLI entry point. Signal handling (SIGINT, SIGTERM) is automatically enabled, and `process.exit` is called on termination.

```typescript
async function runMain(command: Command, options?: MainOptions): Promise<never>;
```

#### Parameters

| Name      | Type          | Description                  |
| --------- | ------------- | ---------------------------- |
| `command` | `Command`     | Command to execute           |
| `options` | `MainOptions` | Execution options (optional) |

#### Return Value

`Promise<never>` - This function does not return as it calls `process.exit`.

#### Example

```typescript
import { defineCommand, runMain } from "politty";

const command = defineCommand({
  name: "my-cli",
  run: () => console.log("Hello!"),
});

// Basic usage
runMain(command);

// With version
runMain(command, { version: "1.0.0" });

// Debug mode
runMain(command, { version: "1.0.0", debug: true });
```

---

### `runCommand`

Executes a command programmatically. Ideal for testing purposes. Does not call `process.exit` and does not handle signals.

```typescript
async function runCommand<TResult>(
  command: Command,
  argv: string[],
  options?: RunCommandOptions,
): Promise<RunResult<TResult>>;
```

#### Parameters

| Name      | Type                | Description                  |
| --------- | ------------------- | ---------------------------- |
| `command` | `Command`           | Command to execute           |
| `argv`    | `string[]`          | Command-line arguments       |
| `options` | `RunCommandOptions` | Execution options (optional) |

#### Return Value

`Promise<RunResult<TResult>>` - Execution result

#### Example

```typescript
import { defineCommand, runCommand } from "politty";

const command = defineCommand({
  name: "my-cli",
  run: () => ({ success: true }),
});

// Usage in tests
const result = await runCommand(command, ["--verbose", "input.txt"]);
console.log(result.exitCode);
console.log(result.result);
```

---

### `arg`

Attaches metadata to a Zod schema.

```typescript
function arg<T extends z.ZodType>(schema: T, meta: ArgMeta): T;
```

#### Parameters

| Name     | Type        | Description       |
| -------- | ----------- | ----------------- |
| `schema` | `z.ZodType` | Zod schema        |
| `meta`   | `ArgMeta`   | Argument metadata |

#### Return Value

The same Zod schema (chainable)

#### Example

```typescript
import { z } from "zod";
import { arg } from "politty";

// Positional argument
const input = arg(z.string(), {
  positional: true,
  description: "Input file",
});

// Option with alias
const verbose = arg(z.boolean().default(false), {
  alias: "v",
  description: "Verbose output",
});

// Option with placeholder
const output = arg(z.string(), {
  alias: "o",
  description: "Output file",
  placeholder: "FILE", // Shows as --output <FILE> in help
});
```

---

### `generateHelp`

Generates help text for a command.

```typescript
function generateHelp(command: Command, options: HelpOptions): string;
```

#### Parameters

| Name      | Type          | Description                  |
| --------- | ------------- | ---------------------------- |
| `command` | `Command`     | Command to generate help for |
| `options` | `HelpOptions` | Help generation options      |

#### Return Value

Formatted help text

---

### `extractFields`

Extracts field information from a schema.

```typescript
function extractFields(schema: ArgsSchema): ExtractedFields;
```

#### Example

```typescript
import { z } from "zod";
import { extractFields, arg } from "politty";

const schema = z.object({
  name: arg(z.string(), { positional: true }),
  verbose: arg(z.boolean().default(false), { alias: "v" }),
});

const extracted = extractFields(schema);
// extracted.fields contains information about each field
```

---

### `validatePositionalConfig`

Validates whether the positional argument configuration is valid.

```typescript
function validatePositionalConfig(extracted: ExtractedFields): void;
```

Throws `PositionalConfigError` if the configuration is invalid.

---

### `formatValidationErrors`

Formats validation errors into a user-friendly string.

```typescript
function formatValidationErrors(errors: ValidationError[]): string;
```

---

## Types

### `Command`

Type for a defined command.

```typescript
interface Command<TArgs, TResult> {
  /** Command name (required) */
  name: string;
  description?: string;
  argsSchema?: ArgsSchema;
  subCommands?: Record<string, Command | (() => Promise<Command>)>;
  setup?: (context: SetupContext<TArgs>) => void | Promise<void>;
  run?: (args: TArgs) => TResult | Promise<TResult>;
  cleanup?: (context: CleanupContext<TArgs>) => void | Promise<void>;
  /** Additional notes */
  notes?: string;
  /** Usage examples */
  examples?: Example[];
}
```

---

### `Example`

Type for defining command usage examples.

```typescript
interface Example {
  /** Command arguments (e.g., "config.json" or "--loud Alice") */
  cmd: string;
  /** Description of the example */
  desc: string;
  /** Expected output (for documentation, optional) */
  output?: string;
}
```

---

### `ArgMeta`

Type for argument metadata (union type).

```typescript
type ArgMeta = RegularArgMeta | BuiltinOverrideArgMeta;
```

---

### `BaseArgMeta`

Base metadata common to all argument types.

```typescript
interface BaseArgMeta {
  /** Argument description */
  description?: string;
  /** Treat as positional argument */
  positional?: boolean;
  /** Placeholder for help display */
  placeholder?: string;
  /**
   * Environment variable name (single or array).
   * If array, the first element takes priority.
   * CLI arguments always take priority over environment variables.
   */
  env?: string | string[];
}
```

---

### `RegularArgMeta`

Metadata for regular arguments.

```typescript
interface RegularArgMeta extends BaseArgMeta {
  /** Short alias (e.g., 'v' allows using --verbose as -v) */
  alias?: string;
}
```

---

### `BuiltinOverrideArgMeta`

Metadata for overriding built-in aliases (-h, -H).

```typescript
interface BuiltinOverrideArgMeta extends BaseArgMeta {
  /** Built-in alias to override ('h' or 'H') */
  alias: "h" | "H";
  /** Must be true to override built-in alias */
  overrideBuiltinAlias: true;
}
```

---

### `Logger`

Logger interface for CLI output.

```typescript
interface Logger {
  /** Output message to stdout */
  log(message: string): void;
  /** Output message to stderr */
  error(message: string): void;
}
```

---

### `MainOptions`

Type for options passed to `runMain`.

```typescript
interface MainOptions {
  /** Command version */
  version?: string;
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
  /** Capture console output during execution (default: false) */
  captureLogs?: boolean;
  /** Skip command definition validation (useful in production when already tested) */
  skipValidation?: boolean;
  /** Custom logger (default: console) */
  logger?: Logger;
  /** Global arguments schema (available to all subcommands) */
  globalArgs?: ArgsSchema;
}
```

---

### `RunCommandOptions`

Type for options passed to `runCommand`.

```typescript
interface RunCommandOptions {
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
  /** Capture console output during execution (default: false) */
  captureLogs?: boolean;
  /** Skip command definition validation (useful in production when already tested) */
  skipValidation?: boolean;
  /** Custom logger (default: console) */
  logger?: Logger;
  /** Global arguments schema (available to all subcommands) */
  globalArgs?: ArgsSchema;
}
```

---

### `RunResult`

Type for command execution result (discriminated union).

```typescript
type RunResult<T> = RunResultSuccess<T> | RunResultFailure;
```

---

### `RunResultSuccess`

Execution result on success.

```typescript
interface RunResultSuccess<T = unknown> {
  /** Indicates success */
  success: true;
  /** Return value from run function */
  result: T | undefined;
  /** Error (not present on success) */
  error?: never;
  /** Exit code (always 0 on success) */
  exitCode: 0;
  /** Logs collected during execution */
  logs: CollectedLogs;
}
```

---

### `RunResultFailure`

Execution result on failure.

```typescript
interface RunResultFailure {
  /** Indicates failure */
  success: false;
  /** Return value from run function (not present on failure) */
  result?: never;
  /** Error that occurred */
  error: Error;
  /** Exit code (non-zero) */
  exitCode: number;
  /** Logs collected during execution */
  logs: CollectedLogs;
}
```

---

### `CollectedLogs`

Logs collected during execution.

```typescript
interface CollectedLogs {
  /** All recorded log entries */
  entries: LogEntry[];
}
```

---

### `LogEntry`

A single log entry.

```typescript
interface LogEntry {
  /** Log message */
  message: string;
  /** Time when logged */
  timestamp: Date;
  /** Log level */
  level: LogLevel;
  /** Output stream */
  stream: LogStream;
}
```

---

### `LogLevel`

Type for log levels.

```typescript
type LogLevel = "log" | "info" | "debug" | "warn" | "error";
```

---

### `LogStream`

Type for output streams.

```typescript
type LogStream = "stdout" | "stderr";
```

---

### `GlobalArgs`

Interface for declaration merging to provide type-safe global options. Extend this interface in your project to automatically add global args types to all commands.

```typescript
// In politty
interface GlobalArgs {}

// In your project
declare module "politty" {
  interface GlobalArgs {
    verbose: boolean;
    config?: string;
  }
}
```

When extended, all `run`, `setup`, and `cleanup` handlers automatically receive the merged args type.

---

### `SetupContext`

Type for context passed to the `setup` hook.

```typescript
interface SetupContext<TArgs> {
  /** Parsed and validated arguments */
  args: TArgs;
}
```

---

### `CleanupContext`

Type for context passed to the `cleanup` hook.

```typescript
interface CleanupContext<TArgs> {
  /** Parsed and validated arguments */
  args: TArgs;
  /** Error that occurred during execution (if any) */
  error?: Error;
}
```

> **Note:** The `run` function receives the parsed arguments `args` directly, not a context object.

---

### `HelpOptions`

Type for options passed to `generateHelp`.

```typescript
interface HelpOptions {
  /** Show subcommand list */
  showSubcommands?: boolean;
  /** Show subcommand options */
  showSubcommandOptions?: boolean;
  /** Custom descriptions for built-in options */
  descriptions?: BuiltinOptionDescriptions;
  /** Command hierarchy context */
  context?: CommandContext;
}
```

---

### `BuiltinOptionDescriptions`

Type for customizing built-in option descriptions.

```typescript
interface BuiltinOptionDescriptions {
  /** Description for --help option */
  help?: string;
  /** Description for --help-all option */
  helpAll?: string;
  /** Description for --version option */
  version?: string;
}
```

---

### `CommandContext`

Context for command hierarchy.

```typescript
interface CommandContext {
  /** Full command path (e.g., ["config", "get"]) */
  commandPath?: string[];
  /** Root command name */
  rootName?: string;
  /** Root command version */
  rootVersion?: string;
}
```

---

### `ExtractedFields`

Type for field information extracted from a schema.

```typescript
interface ExtractedFields {
  /** All field definitions */
  fields: ResolvedFieldMeta[];
  /** Original schema */
  schema: ArgsSchema;
  /** Schema type */
  schemaType: "object" | "discriminatedUnion" | "union" | "xor" | "intersection";
  /** Discriminator key (for discriminatedUnion) */
  discriminator?: string;
  /** Variants (for discriminatedUnion) */
  variants?: Array<{
    discriminatorValue: string;
    fields: ResolvedFieldMeta[];
    description?: string;
  }>;
  /** Options (for union) */
  unionOptions?: ExtractedFields[];
  /** Schema description */
  description?: string;
}
```

---

### `ResolvedFieldMeta`

Type for resolved field metadata.

```typescript
interface ResolvedFieldMeta {
  /** Field name (camelCase, as defined in schema) */
  name: string;
  /** CLI option name (kebab-case, used on command line) */
  cliName: string;
  /** Short alias */
  alias?: string;
  /** Description */
  description?: string;
  /** Whether positional argument */
  positional: boolean;
  /** Placeholder */
  placeholder?: string;
  /** Environment variable name (single or array) */
  env?: string | string[];
  /** Whether required */
  required: boolean;
  /** Default value */
  defaultValue?: unknown;
  /** Detected type */
  type: "string" | "number" | "boolean" | "array" | "unknown";
  /** Original Zod schema */
  schema: z.ZodType;
  /** True if overriding built-in alias (-h, -H) */
  overrideBuiltinAlias?: true;
}
```

---

### `ValidationError`

Type for validation errors.

```typescript
interface ValidationError {
  /** Path where error occurred */
  path: (string | number)[];
  /** Error message */
  message: string;
}
```

---

### `ValidationResult`

Type for validation result.

```typescript
type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: ValidationError[] };
```

---

### `PositionalConfigError`

Error class representing positional argument configuration errors.

```typescript
class PositionalConfigError extends Error {
  name: "PositionalConfigError";
}
```

---

### `DuplicateAliasError`

Error class representing duplicate alias errors.

```typescript
class DuplicateAliasError extends Error {
  name: "DuplicateAliasError";
}
```

---

### `DuplicateFieldError`

Error class representing duplicate field name errors.

```typescript
class DuplicateFieldError extends Error {
  name: "DuplicateFieldError";
}
```

---

### `ReservedAliasError`

Error class representing reserved alias usage errors.

```typescript
class ReservedAliasError extends Error {
  name: "ReservedAliasError";
}
```

---

### `CommandValidationError`

Type for command definition validation errors.

```typescript
interface CommandValidationError {
  /** Error type */
  type: "positional" | "duplicateAlias" | "duplicateField" | "reservedAlias";
  /** Error message */
  message: string;
}
```

---

### `CommandValidationResult`

Type for command definition validation result.

```typescript
type CommandValidationResult =
  | { success: true }
  | { success: false; errors: CommandValidationError[] };
```

---

## Exports

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
export { isColorEnabled, logger, setColorEnabled, styles, symbols } from "./output/logger.js";

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
