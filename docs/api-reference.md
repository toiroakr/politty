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
| `aliases`     | `string[]`                                                  | Alternative names for the command         |
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

### `enableCompileCache`

Enables the Node.js on-disk compile cache (V8 code cache) for the current process. Exported from the dependency-free `politty/compile-cache` subpath so a minimal bin shim can call it before the real CLI graph is imported. Never throws; no-ops on runtimes without `module.enableCompileCache` (Node.js < 22.8.0). The `NODE_COMPILE_CACHE` environment variable always takes precedence over the derived directory.

`runMain` calls this automatically (see `MainOptions.compileCache`), but only modules imported after that point benefit — see [Faster Startup (Compile Cache)](./recipes.md#faster-startup-compile-cache) for the bin-shim pattern that covers the whole CLI.

```typescript
function enableCompileCache(options?: string | { programName?: string; cacheDir?: string }): {
  enabled: boolean;
  directory?: string;
};
```

#### Example

```typescript
#!/usr/bin/env node
// bin.ts — keep this file's static imports minimal
import { enableCompileCache } from "politty/compile-cache";

enableCompileCache("my-cli");
// => cache in ${XDG_CACHE_HOME:-$HOME/.cache}/my-cli/node-compile-cache
await import("./cli.js");
```

---

### `generateCompileCacheShim`

Generates the compile-cache bin shim described above as an executable file, so it can be produced by a `postbuild`/`prepack` script instead of living in source. Also available as the `politty generate-shim` CLI command.

The generated shim is an ES module: a `.js` output requires a `"type": "module"` package; use `.mjs` otherwise. The program name defaults to the first `bin` name in the nearest `package.json`, falling back to the package name without its scope.

```typescript
function generateCompileCacheShim(options: {
  /** Module specifier the shim imports, relative to the shim file (e.g. "./cli.js") */
  entry: string;
  /** Output path (e.g. "dist/bin.js") */
  out: string;
  /** Program name for the cache directory (default: derived from package.json) */
  program?: string;
  /** Base directory for paths and package.json (default: process.cwd()) */
  cwd?: string;
}): {
  outputPath: string;
  program: string;
  entry: string;
};
```

#### Example

```bash
# package.json: "postbuild": "politty generate-shim --entry ./cli.js --out dist/bin.js"
politty generate-shim --entry ./cli.js --out dist/bin.js
# => Generated compile-cache shim: dist/bin.js (program: my-cli, entry: ./cli.js)
```

---

## Shell Completion

### `withCompletionCommand`

Wraps a command with shell completion support. Adds a `completion` subcommand, a hidden `__complete` command for dynamic completion, and a hidden `__refresh-completion` command used by the on-disk cache auto-refresh path. See [Shell Completion](./shell-completion.md#auto-refresh) for details on the refresh flow and the `POLITTY_NO_COMPLETION_REFRESH` opt-out.

```typescript
function withCompletionCommand<T extends AnyCommand>(
  command: T,
  options?: string | WithCompletionOptions,
): T;
```

#### Parameters

| Name      | Type                              | Description                    |
| --------- | --------------------------------- | ------------------------------ |
| `command` | `AnyCommand`                      | Command to wrap                |
| `options` | `string \| WithCompletionOptions` | Program name or options object |

**WithCompletionOptions:**

| Property           | Type                    | Description                                                                                                           |
| ------------------ | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `programName`      | `string?`               | Override program name (defaults to command.name)                                                                      |
| `globalArgsSchema` | `ArgsSchema?`           | Global args schema for deriving global options in completion                                                          |
| `cacheDir`         | `string?`               | Hardcode the on-disk cache directory used by the rc loader and the runMain background refresh (overrides XDG default) |
| `programVersion`   | `string?`               | Program version embedded in the script header                                                                         |
| `bundledWorker`    | `BundledWorkerOptions?` | Package-relative bundled worker lookup configuration for dispatcher mode                                              |

#### Example

```typescript
import { defineCommand, runMain, withCompletionCommand } from "politty";

const mainCommand = withCompletionCommand(
  defineCommand({
    name: "mycli",
    subCommands: {/* ... */},
  }),
);

// Now includes:
// - mycli completion bash|zsh|fish [--install] [--loader] [--instructions]
// - mycli __complete --shell <shell> -- <args>
// - mycli __refresh-completion <shell>  (hidden; spawned by the rc loader / runMain hook)
// - mycli __completion-worker-path <shell>  (hidden; prints a bundled worker path)

runMain(mainCommand);
```

---

### `generateCompletion`

Generates a shell completion script for a command.

```typescript
function generateCompletion(command: AnyCommand, options: CompletionOptions): CompletionResult;
```

#### Parameters

| Name      | Type                | Description         |
| --------- | ------------------- | ------------------- |
| `command` | `AnyCommand`        | Command to generate |
| `options` | `CompletionOptions` | Generation options  |

**CompletionOptions:**

| Property              | Type                    | Description                                                                                                                                                                                                                                                                                                            |
| --------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shell`               | `ShellType`             | Target shell: "bash", "zsh", or "fish"                                                                                                                                                                                                                                                                                 |
| `programName`         | `string`                | Program name as invoked                                                                                                                                                                                                                                                                                                |
| `includeSubcommands`  | `boolean?`              | Include subcommand completions (default: true)                                                                                                                                                                                                                                                                         |
| `includeDescriptions` | `boolean?`              | Include descriptions (default: true)                                                                                                                                                                                                                                                                                   |
| `mode`                | `CompletionMode?`       | Defaults to `static` (self-contained) for this direct API. Pass `dispatcher` for runtime resolution — it requires the CLI to register the hidden `__complete` / `__refresh-completion` commands via `withCompletionCommand` / `createCompletionCommand`. The `completion <shell>` subcommand defaults to `dispatcher`. |
| `globalArgsSchema`    | `ArgsSchema?`           | Global args schema for deriving global options in completion                                                                                                                                                                                                                                                           |
| `binPath`             | `string?`               | Path to the binary whose mtime is the freshness signature (defaults to `process.argv[1]`)                                                                                                                                                                                                                              |
| `programVersion`      | `string?`               | Program version embedded in the script header                                                                                                                                                                                                                                                                          |
| `cacheDir`            | `string?`               | Cache directory hardcoded into the generated rc loader (defaults to XDG cache dir resolved at runtime)                                                                                                                                                                                                                 |
| `bundledWorker`       | `BundledWorkerOptions?` | Package-relative bundled worker lookup configuration for dispatcher mode                                                                                                                                                                                                                                               |

#### Return Value

```typescript
interface CompletionResult {
  script: string; // The completion script
  shell: ShellType; // Shell type
  installInstructions: string; // Installation instructions
}
```

#### Example

```typescript
import { generateCompletion } from "politty/completion";

const result = generateCompletion(command, {
  shell: "bash",
  programName: "mycli",
});

console.log(result.script);
```

> This direct API emits a self-contained **static** script by default. For runtime
> dispatcher completion, pass `mode: "dispatcher"` and make sure the command tree
> has the hidden runtime commands registered (use `withCompletionCommand` /
> `createCompletionCommand`, which the `completion <shell>` subcommand relies on).

---

### `generateBundledCompletionWorker`

Generates a bundled worker artifact for dispatcher completion and validates
that it is usable by the built CLI package.

```typescript
function generateBundledCompletionWorker(
  options: GenerateBundledCompletionWorkerOptions,
): Promise<GenerateBundledCompletionWorkerResult>;
```

#### Parameters

| Property      | Type                                   | Description                                                                  |
| ------------- | -------------------------------------- | ---------------------------------------------------------------------------- |
| `bin`         | `string`                               | CLI binary or built JS entry file to invoke                                  |
| `programName` | `string`                               | Program name expected in worker metadata                                     |
| `shell`       | `ShellType`                            | Worker shell to generate                                                     |
| `outputPath`  | `string?`                              | Output path, defaulting to `dist/completion/<shell>-worker.<ext>`            |
| `verify`      | `boolean?`                             | Also verify that `__completion-worker-path <shell>` resolves to `outputPath` |
| `cwd`         | `string?`                              | Working directory for relative paths                                         |
| `env`         | `Record<string, string \| undefined>?` | Extra environment passed to the target binary                                |
| `quiet`       | `boolean?`                             | Suppress the success message                                                 |

#### Example

```typescript
import { generateBundledCompletionWorker } from "politty/completion";

await generateBundledCompletionWorker({
  bin: "dist/cli/index.mjs",
  programName: "mycli",
  shell: "zsh",
  verify: true,
});
```

The package-script equivalent is:

```sh
politty generate-worker --bin dist/cli/index.mjs --program mycli --shell zsh --verify
```

---

### `createDynamicCompleteCommand`

Creates the hidden `__complete` command for dynamic completion.

```typescript
function createDynamicCompleteCommand(
  rootCommand: AnyCommand,
  programName?: string,
  globalArgsSchema?: ArgsSchema,
): Command;
```

#### Usage

The `__complete` command is automatically added by `withCompletionCommand`. It can be invoked directly:

```bash
# Get completions for "mycli build --"
mycli __complete --shell fish -- build --

# Output (tab-separated: value\tdescription)
--watch	Watch mode
--output	Output directory
:4
```

The last line (`:N`) is a directive that tells the shell how to handle completions:

- `:0` - Default
- `:4` - Filter by prefix
- `:16` - File completion
- `:32` - Directory completion

---

### `parseCompletionContext`

Parses a partial command line to determine what kind of completion is needed.

```typescript
function parseCompletionContext(
  argv: string[],
  rootCommand: AnyCommand,
  globalArgsSchema?: ArgsSchema,
): CompletionContext;
```

#### Return Value

```typescript
interface CompletionContext {
  subcommandPath: string[]; // e.g., ["plugin", "add"]
  currentCommand: AnyCommand; // Resolved command
  currentWord: string; // Current partial word
  previousWord: string; // Previous word
  completionType: CompletionType; // What to complete
  targetOption?: CompletableOption; // For option-value completion
  positionalIndex?: number; // For positional completion
  options: CompletableOption[]; // Available options
  subcommands: string[]; // Available subcommands
  positionals: CompletablePositional[];
  usedOptions: Set<string>; // Already used options
  parsedArgs: Record<string, unknown>; // Other arg values (for dynamic resolvers)
  previousValues: string[]; // Prior values for the option/positional being completed
}

type CompletionType = "subcommand" | "option-name" | "option-value" | "positional";
```

---

### `generateCandidates`

Generates completion candidates based on context. Async because dynamic resolvers may return promises.

```typescript
function generateCandidates(
  context: CompletionContext,
  options: { shell: "bash" | "zsh" | "fish" },
): Promise<CandidateResult>;
```

#### Return Value

```typescript
interface CandidateResult {
  candidates: CompletionCandidate[];
  directive: number; // Bitwise flags
}

interface CompletionCandidate {
  value: string;
  description?: string;
  type?: "option" | "subcommand" | "value" | "file" | "directory";
}
```

---

### `CompletionMeta`

Completion configuration for arguments.

```typescript
interface CompletionMeta {
  /** Completion type */
  type?: "file" | "directory" | "none";
  /** Custom completion (mutually exclusive: choices | shellCommand | resolve | expand) */
  custom?: {
    /** Static choices */
    choices?: string[];
    /** Shell command for dynamic values */
    shellCommand?: string;
    /** In-process JS resolver (see DynamicCompletionResolver) */
    resolve?: DynamicCompletionResolver;
    /** Pre-enumerated completion baked into the static shell script (see ExpandCompletion) */
    expand?: ExpandCompletion;
  };
  /** File extension filters (for type: "file") */
  extensions?: string[];
}
```

---

### `DynamicCompletionResolver`

Callback invoked at completion time inside the `__complete` command.

```typescript
type DynamicCompletionResolver = (
  ctx: DynamicCompletionContext,
) => DynamicCompletionResult | Promise<DynamicCompletionResult>;

interface DynamicCompletionContext {
  /** Word being completed (`--field=` inline prefix is stripped before this is set). */
  currentWord: string;
  /** Target shell formatting requested by the caller. */
  shell: "bash" | "zsh" | "fish";
  /** Best-effort parsed values of OTHER args (camelCase keys, raw strings). */
  parsedArgs: Readonly<Record<string, unknown>>;
  /** Values already supplied for the same option/positional being completed. */
  previousValues: readonly string[];
  /** Subcommand path from root (e.g. ["api"]). */
  subcommandPath: readonly string[];
}

interface DynamicCompletionResult {
  candidates: Array<string | { value: string; description?: string }>;
  /** Optional override; defaults to FilterPrefix | NoFileCompletion. */
  directive?: number;
}
```

Specifying more than one of `choices`, `shellCommand`, `resolve`, or `expand` on the same field throws at command-definition time. Dispatcher scripts delegate every completion request to `<program> __complete --shell <shell>`, resolving the executable currently visible on `PATH` at TAB time. Static shell scripts automatically delegate to `<program> __complete --shell <shell>` when a field uses `resolve`. With `expand`, dispatcher mode calls `enumerate` for the already typed dependency values inside `__complete`; static mode computes the candidate table at script-generation time and inlines it into the script.

---

### `ExpandCompletion`

Pre-enumerated value completion. Use when candidates can be computed from a finite set of sibling arg values (each must have a static `choices` or enum schema). Dispatcher mode calls `enumerate` from `__complete` for the dependency values already typed on the command line. Static mode walks the cartesian product of the `dependsOn` values at script-generation time, calls `enumerate` for each combination, and bakes the resulting table into the static shell script.

```typescript
interface ExpandCompletion {
  /**
   * Sibling arg names (camelCase, same command) whose runtime values
   * drive the candidate set. Each must have a static `choices` or enum
   * schema. Chaining `expand` specs is not supported.
   */
  dependsOn: readonly string[];
  /**
   * Pure function called once per combination of dependsOn values at
   * script-generation time. Returns the candidates for that combination.
   * Strings imply no description; objects carry an optional description
   * surfaced by zsh and fish.
   */
  enumerate: (
    deps: Readonly<Record<string, string>>,
  ) => ReadonlyArray<string | { value: string; description?: string }>;
}
```

Properties and constraints:

- `dependsOn` must be non-empty and may not reference the field itself or any sibling without a static value set. Validation errors throw at command-definition time with the offending field name.
- In dispatcher mode, `enumerate` runs synchronously inside `__complete` for the currently typed dependency values. In static mode, it runs when the user invokes `<program> completion <shell> --static`; if it throws, the error is wrapped with the field name and the offending `deps` snapshot.
- bash emits one prefix-scalar variable per table entry (`<base>__<encKey>=<candidates>`) so the generated script runs on Bash 3.2 (macOS default `/bin/bash`) without associative arrays; zsh emits one global associative array per spec (`typeset -gA`); fish emits an inline `switch` (no associative arrays). bash drops descriptions; zsh uses `value:description` for `_describe`; fish uses tab-separated `value\tdescription`.

#### Example

```typescript
import { z } from "zod";
import { arg, defineCommand } from "politty";

const command = defineCommand({
  name: "deploy",
  args: z.object({
    // File completion with extension filter
    config: arg(z.string(), {
      completion: { type: "file", extensions: ["json", "yaml"] },
    }),

    // Directory completion
    outputDir: arg(z.string(), {
      completion: { type: "directory" },
    }),

    // Static choices
    env: arg(z.string(), {
      completion: { custom: { choices: ["dev", "staging", "prod"] } },
    }),

    // Dynamic from shell command
    branch: arg(z.string().optional(), {
      completion: { custom: { shellCommand: "git branch --format='%(refname:short)'" } },
    }),

    // Auto-detected from z.enum()
    format: arg(z.enum(["json", "yaml"]), {}),
  }),
  run: () => {},
});
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
  /** Shell completion configuration */
  completion?: CompletionMeta;
  /** Interactive prompt configuration (see [Interactive Prompts](./interactive-prompts.md)) */
  prompt?: PromptMeta;
}
```

---

### `RegularArgMeta`

Metadata for regular arguments.

```typescript
interface RegularArgMeta extends BaseArgMeta {
  /**
   * Alias name(s).
   * - 1-char string  → short alias (`-v`)
   * - >1-char string → long alias (`--long-name`, e.g. `--to-be` for `--tobe`)
   * - array          → multiple aliases of either kind
   */
  alias?: string | string[];
  /**
   * Alias name(s) accepted by the parser but hidden from help,
   * generated docs, and shell completion (e.g. legacy names).
   */
  hiddenAlias?: string | string[];
}
```

---

### `BuiltinOverrideArgMeta`

Metadata for overriding built-in aliases (-h, -H).

```typescript
interface BuiltinOverrideArgMeta extends BaseArgMeta {
  /** Built-in alias to override ('h' or 'H'); may be combined with extra aliases */
  alias: "h" | "H" | Array<"h" | "H" | string>;
  /** Hidden aliases (accepted but not surfaced in help/docs/completion) */
  hiddenAlias?: string | string[];
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
  /** Prompt resolver for interactive missing-arg prompts */
  prompt?: PromptResolver;
  /**
   * Node.js on-disk compile cache control (default: derive the cache
   * directory from the command name). Pass a string to use a custom
   * directory, or `false` to disable. See "Faster Startup" in recipes.md.
   */
  compileCache?: boolean | string;
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
  /** Aliases (1-char = short `-v`, multi-char = long `--to-be`) */
  alias?: string[];
  /** Aliases accepted by parser but hidden from help/docs/completion */
  hiddenAlias?: string[];
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
  { success: true; data: T } | { success: false; errors: ValidationError[] };
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
  { success: true } | { success: false; errors: CommandValidationError[] };
```

---

## Skill Management (`politty/skill`)

Validates SKILL.md files against the [Agent Skills specification](https://agentskills.io/specification) and installs them by populating `.agents/skills/<name>` and each agent-specific directory (e.g. `.claude/skills/<name>`) from the source (typically `node_modules/<pkg>/skills/<name>`). The materialization is controlled by `mode`: `"symlink"` (default) symlinks the source into place and throws with guidance to retry with `"copy"` on filesystems without symlink support (e.g. Windows without Developer Mode); `"copy"` always copies. Agent-specific slots route through the canonical `.agents/skills/<name>` so one `sync` swaps all hops at once. Source SKILL.md must pre-declare `metadata["politty-cli"] = "{package}:{cliName}"`; the `skills add` / `skills sync` subcommands verify the stamp before installing, and `skills remove` / `skills sync` refuse to delete skills owned by another tool. `installSkill` itself does not validate ownership — programmatic callers that bypass `withSkillCommand` are responsible for that check. The installer never writes to SKILL.md.

### `withSkillCommand`

Wraps a command with a `skills` subcommand for managing SKILL.md-based agent skills.

```typescript
function withSkillCommand<T extends AnyCommand>(
  command: T,
  options: SkillCommandOptions,
): WithSkillCommand<T>;
```

Throws if `command.subCommands.skills` already exists.

#### Parameters

| Name      | Type                  | Description           |
| --------- | --------------------- | --------------------- |
| `command` | `AnyCommand`          | Command to wrap       |
| `options` | `SkillCommandOptions` | Skill command options |

**SkillCommandOptions:**

| Property            | Type                  | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `sourceDir`         | `string`              | Source directory containing SKILL.md files (symlinks within the source tree are followed)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `package`           | `string`              | npm package name that owns these skills. Combined with the command name as `"{package}:{cliName}"` and compared against each source SKILL.md's `metadata["politty-cli"]` stamp; mismatches are refused                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `mode`              | `InstallMode`         | Install materialization strategy (`"symlink"` \| `"copy"`). Defaults to `"symlink"` — symlink the source into place; install throws with guidance to retry with `"copy"` on filesystems without symlink support (e.g. Windows without Developer Mode)                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `cwd`               | `string?`             | Install-root directory used by every `skills` subcommand. Default: walk up from `process.cwd()` to the first ancestor containing `.git/` or `package.json`, falling back to `process.cwd()`. Pass an absolute (or cwd-relative) path to override — e.g. a CLI-specific config dir                                                                                                                                                                                                                                                                                                                                                                                                    |
| `globalArgs`        | `ArgsSchema?`         | The same schema passed to `runMain`/`runCommand`'s `globalArgs`. When it already declares a same-named _non-positional boolean_ `verbose`/`json` field, `skills add`/`skills sync`'s `--verbose` and `skills list`'s `--json` are omitted from their own schema automatically, so the host's global flag of the same name takes priority — no manual configuration. A same-named non-boolean field doesn't trigger this (the local flag stays declared), but politty itself throws `FieldTypeConflictError` at parse time for a same-named field with conflicting definitions across `globalArgs` and a command's own schema — rename or remove the conflicting global field instead |
| `flags`             | `SkillFlagOverrides?` | Per-flag overrides: `exclude.alias` (rename/disable `skills sync --exclude`'s short alias, default `"x"`) and `verbose.alias` (rename/disable `skills add`/`skills sync --verbose`'s short alias — a collision independent of `globalArgs`'s field-name auto-detection, e.g. the host's `-v` belongs to an unrelated flag)                                                                                                                                                                                                                                                                                                                                                           |
| `commandMap`        | `{ add?, remove? }?`  | Primary name + aliases for `skills add`/`skills remove`. In each array the first element becomes the dispatched name, the rest become aliases. Default: `add: ["add", "install"]`, `remove: ["remove", "uninstall"]`                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `unknownKeys`       | `UnknownKeysMode?`    | Unknown-flag handling for `add`/`sync`/`remove`/`list`'s own schemas (`"strict"` \| `"strip"` \| `"passthrough"`). Default `"strip"` (warn and drop the value, matching politty's own `z.object()`); `"passthrough"` matches `z.object().passthrough()` — no warning, but the value is _kept_ on the parsed args under its raw CLI name instead of dropped. Applied uniformly to all four; never rejects a value that legitimately arrives via `globalArgs`                                                                                                                                                                                                                          |
| `descriptionAppend` | `string \| false`     | Hint appended to the wrapped command's `description` so `--help` advertises the skills subcommand. Default: a one-line auto-generated hint. Pass a string to override the hint, or `false` to leave the description untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

#### Generated Subcommands

| Command                        | Description                                                 |
| ------------------------------ | ----------------------------------------------------------- |
| `skills sync [--exclude name]` | Remove orphans and reinstall all skills owned by this CLI   |
| `skills add [name ...]`        | Install one or more named skills, or all when no name given |
| `skills remove [name]`         | Remove skill(s) owned by this CLI                           |
| `skills list [--json]`         | List available skills from source                           |

#### Example

```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "politty";
import { withSkillCommand } from "politty/skill";

const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");

const cli = withSkillCommand(
  defineCommand({
    name: "my-agent",
    subCommands: {/* ... */},
  }),
  { sourceDir, package: "@my-agent/skills" },
);

runMain(cli);
```

---

### `scanSourceDir`

Scans a directory for SKILL.md files.

```typescript
function scanSourceDir(sourceDir: string): ScanResult;
```

If the directory itself contains a SKILL.md, it is treated as a single-skill source; the parent-dir name match is skipped in that case. Otherwise, each subdirectory with a SKILL.md is validated; the subdirectory name **must** equal the frontmatter `name`. Symlinked skill directories and symlinked SKILL.md files are followed (npm packages already execute arbitrary JS on install, so refusing symlinks here would not raise the trust boundary).

**ScanResult:**

```typescript
interface ScanResult {
  skills: DiscoveredSkill[];
  errors: ScanError[];
}

interface ScanError {
  path: string;
  reason: ScanErrorReason;
  message: string;
  /**
   * Parsed frontmatter `name`, populated only for `name-mismatch`.
   * Lets consumers like `sync`'s orphan-retention guard protect an
   * install at either the directory basename or the frontmatter name.
   */
  skillName?: string;
}

// Runtime tuple of every scan error reason (for exhaustive iteration).
const SCAN_ERROR_REASONS = [
  "parse-failed",
  "name-mismatch",
  "read-failed",
  "missing-source",
] as const;
type ScanErrorReason = (typeof SCAN_ERROR_REASONS)[number];
```

---

### `installSkill`

Populates `.agents/skills/<name>` from `skill.sourcePath` (typically `node_modules/<pkg>/skills/<name>`) and each agent-specific directory (e.g. `.claude/skills/<name>`) from the canonical slot. The materialization is controlled by `options.mode`:

- `"symlink"` (default) — symlink the source into place. On `symlinkSync` failure (e.g. Windows without Developer Mode, or other filesystems that refuse symlinks) throws an error whose message names the path pair, the underlying cause, and tells the caller to retry with `mode: "copy"`. The original error is attached via the ES2022 `cause` option.
- `"copy"` — recursive copy only; works anywhere. Requires the source SKILL.md to carry a `metadata["politty-cli"]` stamp (any value): without one, the call throws an actionable error. This is necessary because `clearInstallSlot` only rm-rf's a real directory when its on-disk stamp matches, so a second copy-mode install of an unstamped source would fail with "Refusing to replace non-symlink".

Never writes to the source SKILL.md; the ownership stamp is authored by the skill package, not rewritten at install time.

```typescript
function installSkill(skill: DiscoveredSkill, cwd?: string, options?: InstallSkillOptions): void;

interface InstallSkillOptions {
  /** Install materialization strategy. Default: `"symlink"`. */
  mode?: InstallMode;
}

type InstallMode = "symlink" | "copy";
```

Callers that wrap `installSkill` directly should validate `skill.frontmatter.metadata?.["politty-cli"]` against their expected `"{package}:{cliName}"` before calling; the primitive does not compare ownership itself. `withSkillCommand`'s `skills add` / `skills sync` do this automatically. In `mode: "copy"` the primitive additionally requires _some_ `politty-cli` stamp to be present on the source (see above), so the same caller-side ownership check naturally satisfies that precondition.

---

### `uninstallSkill`

Removes a skill's symlinks at `.agents/skills/<name>` and each agent-specific directory. Real directories (copy-mode installs) are removed only when `options.expectedOwnership` is provided and the directory's SKILL.md carries that stamp — unstamped or foreign real directories are always left alone. The `skills remove` / `skills sync` subcommands always pass `expectedOwnership` after their own ownership check; direct programmatic callers get the conservative symlink-only default.

```typescript
function uninstallSkill(name: string, cwd?: string, options?: UninstallSkillOptions): void;

interface UninstallSkillOptions {
  /**
   * If provided, real directories are removed when their SKILL.md's
   * `metadata["politty-cli"]` equals this stamp. Without it, only
   * symlinks are unlinked.
   */
  expectedOwnership?: string;
}
```

---

### `readInstalledOwnership`

Returns `metadata["politty-cli"]` from the installed SKILL.md at `.agents/skills/<name>/SKILL.md`. For symlink-mode installs this reads through to the source package's authored stamp; for copy-mode installs it reads the stamp captured in the local copy. Returns `null` if the skill is not installed, the canonical symlink is broken (source package uninstalled), or the stamp is absent/malformed. Other read errors (e.g. EACCES) are surfaced rather than swallowed, so `remove` / `sync` do not misinterpret a transient failure as "not installed" and clobber user data.

```typescript
function readInstalledOwnership(name: string, cwd?: string): string | null;
```

---

### `hasInstalledSkill`

Returns `true` when `.agents/skills/<name>/SKILL.md` resolves to a readable file (through a valid symlink or directly), `false` when the path is absent or the canonical symlink is broken. Use together with `readInstalledOwnership` to distinguish its two `null` cases — "not installed" (safe to install fresh) vs. "installed but unstamped" (a legacy or manual install that should not be silently clobbered).

```typescript
function hasInstalledSkill(name: string, cwd?: string): boolean;
```

---

### `parseSkillMd`

Parses a SKILL.md content string and validates its frontmatter against the Agent Skills specification.

```typescript
function parseSkillMd(content: string): ParsedSkillMd | null;

interface ParsedSkillMd {
  frontmatter: SkillFrontmatter;
  body: string;
  rawContent: string;
}
```

Returns `null` if the frontmatter is missing or fails validation.

---

### `parseFrontmatter`

Parses YAML frontmatter from a markdown string. Tolerates a leading UTF-8 BOM. Returns `{ data: {}, body: content }` when no fence is found. When a fence is present but the YAML inside fails to parse, `data` falls back to `{}` and `parseError` contains the underlying YAML error message — `scanSourceDir` includes this in the `parse-failed` ScanError so users see the actual cause instead of a downstream "name: Required" Zod failure.

```typescript
function parseFrontmatter(content: string): {
  data: Record<string, unknown>;
  body: string;
  parseError?: string;
};
```

---

### `skillFrontmatterSchema`

Zod schema for SKILL.md frontmatter. Enforces the Agent Skills spec and passes through unknown top-level keys via `.passthrough()`.

```typescript
const skillFrontmatterSchema: z.ZodObject<{
  name: z.ZodString; // /^[a-z0-9]+(-[a-z0-9]+)*$/, 1..64
  description: z.ZodString; // 1..1024
  license: z.ZodOptional<z.ZodString>;
  compatibility: z.ZodOptional<z.ZodString>; // <=500
  metadata: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodString>>;
  "allowed-tools": z.ZodOptional<z.ZodString>;
}>;
```

---

### `OWNERSHIP_METADATA_KEY`

String constant `"politty-cli"`. The metadata key under which the `{package}:{cliName}` ownership stamp is declared in each source SKILL.md (politty itself never writes this field).

```typescript
const OWNERSHIP_METADATA_KEY: "politty-cli";
```

---

### `DiscoveredSkill`

A skill found in a source directory.

```typescript
interface DiscoveredSkill {
  frontmatter: SkillFrontmatter;
  sourcePath: string;
  rawContent: string;
}
```

---

### `SkillFrontmatter`

Parsed SKILL.md frontmatter, validated against the Agent Skills specification.

```typescript
type SkillFrontmatter = {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  "allowed-tools"?: string;
  // unknown top-level keys round-trip via .passthrough()
};
```

---

## Prompt Types

For full usage details, see [Interactive Prompts](./interactive-prompts.md).

### `PromptMeta`

Prompt metadata for interactive input when a value is missing.

```typescript
interface PromptMeta {
  /** Prompt message shown to the user. Defaults to the field's description or name. */
  message?: string;
  /** Explicit prompt type. Overrides auto-detection from schema/completion. */
  type?: PromptType;
  /** Choices for select prompt. Overrides enum values from schema. */
  choices?: Array<string | { label: string; value: string }>;
  /** Whether to enable prompting for this field (default: true when prompt is set) */
  enabled?: boolean;
}
```

---

### `PromptType`

Available prompt input types.

```typescript
type PromptType = "text" | "password" | "confirm" | "select" | "file" | "directory";
```

---

### `PromptResolver`

Async callback to resolve missing argument values interactively. Provided by adapter subpath modules.

```typescript
type PromptResolver = (
  rawArgs: Record<string, unknown>,
  extracted: ExtractedFields,
) => Promise<Record<string, unknown>>;
```

---

### `PromptAdapter`

Adapter interface for prompt rendering. Implement this to use a custom prompt library.

```typescript
interface PromptAdapter {
  text(config: { message: string; placeholder?: string }): Promise<string | symbol>;
  password(config: { message: string }): Promise<string | symbol>;
  confirm(config: { message: string }): Promise<boolean | symbol>;
  select(config: {
    message: string;
    options: Array<{ label: string; value: string }>;
  }): Promise<string | symbol>;
  isCancelled(value: unknown): boolean;
}
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
  PromptResolver,
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

// Prompt (subpath exports)
// import { prompt } from "politty/prompt/clack";
// import { prompt } from "politty/prompt/inquirer";
```

### `politty/skill`

```typescript
export { withSkillCommand } from "./skill/index.js";
export {
  hasInstalledSkill,
  installSkill,
  uninstallSkill,
  readInstalledOwnership,
  OWNERSHIP_METADATA_KEY,
} from "./skill/installer.js";
export { parseFrontmatter, parseSkillMd, skillFrontmatterSchema } from "./skill/frontmatter.js";
export type { ParsedSkillMd } from "./skill/frontmatter.js";
export { scanSourceDir } from "./skill/scanner.js";
export { SCAN_ERROR_REASONS } from "./skill/types.js";
export type {
  DiscoveredSkill,
  InstallMode,
  InstallSkillOptions,
  ScanError,
  ScanErrorReason,
  ScanResult,
  SkillCommandOptions,
  SkillFlagOverrides,
  SkillFrontmatter,
  UninstallSkillOptions,
  WithSkillCommand,
} from "./skill/types.js";
```
