import type { z } from "zod";

/**
 * Global arguments interface for declaration merging.
 * Users can extend this interface to add global options type.
 *
 * @example
 * ```typescript
 * declare module "politty" {
 *   interface GlobalArgs extends z.infer<typeof globalArgsSchema> {}
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface GlobalArgs {}

/**
 * Example definition for a command
 */
export interface Example {
  /** Command arguments to execute (e.g., "World" or "--loud Alice") */
  cmd: string;
  /** Description of the example */
  desc: string;
  /** Expected output (optional, for documentation) */
  output?: string;
}

/**
 * Logger interface for CLI output
 * Can be overridden by passing a custom logger to runMain or runCommand
 */
export interface Logger {
  /** Log informational message to stdout */
  log(message: string): void;
  /** Log error message to stderr */
  error(message: string): void;
}

/**
 * Supported schema types for args
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArgsSchema = z.ZodType<Record<string, any>>;

/**
 * Context provided to setup function
 */
export interface SetupContext<TArgs = unknown> {
  /** Parsed and validated arguments (includes global args) */
  args: TArgs & GlobalArgs;
}

/**
 * Context provided to cleanup function
 */
export interface CleanupContext<TArgs = unknown> {
  /** Parsed and validated arguments (includes global args) */
  args: TArgs & GlobalArgs;
  /** Error if command execution failed */
  error?: Error | undefined;
}

/**
 * Base command interface (shared properties)
 * @template TArgsSchema - The Zod schema type for arguments
 * @template TArgs - The inferred args type from the schema
 */
export interface CommandBase<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TArgs = unknown,
> {
  /** Command name (required) */
  name: string;
  /** Command description */
  description?: string | undefined;
  /** Argument schema (preserves the original Zod schema type) */
  args: TArgsSchema;
  /** Subcommands */
  subCommands?: SubCommandsRecord | undefined;
  /** Setup hook */
  setup?: ((context: SetupContext<TArgs>) => void | Promise<void>) | undefined;
  /** Cleanup hook */
  cleanup?: ((context: CleanupContext<TArgs>) => void | Promise<void>) | undefined;
  /** Additional notes */
  notes?: string | undefined;
  /** Example usages for this command */
  examples?: Example[] | undefined;
}

/**
 * A command with a run function
 * @template TArgsSchema - The Zod schema type for arguments
 * @template TArgs - The inferred args type from the schema
 * @template TResult - The return type of the run function
 */
export interface RunnableCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TArgs = unknown,
  TResult = unknown,
> extends CommandBase<TArgsSchema, TArgs> {
  /** Main run function (args includes global args) */
  run: (args: TArgs & GlobalArgs) => TResult;
}

/**
 * A command without a run function (e.g., subcommand-only parent)
 * @template TArgsSchema - The Zod schema type for arguments
 * @template TArgs - The inferred args type from the schema
 */
export interface NonRunnableCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TArgs = unknown,
> extends CommandBase<TArgsSchema, TArgs> {
  /** No run function */
  run?: undefined;
}

/**
 * A defined command (union of runnable and non-runnable)
 */
export type Command<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TArgs = unknown,
  TResult = unknown,
> = RunnableCommand<TArgsSchema, TArgs, TResult> | NonRunnableCommand<TArgsSchema, TArgs>;

/**
 * Type alias for any args type.
 * Note: `any` is required here due to TypeScript's function parameter contravariance.
 * Using `unknown` would make it impossible to assign concrete command types to AnyCommand.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyArgs = any;

/**
 * Type alias for any result type.
 * @internal
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyResult = any;

/**
 * Command type that accepts any args/result types
 * Used in internal functions that don't need specific type information
 */
export type AnyCommand = Command<ArgsSchema | undefined, AnyArgs, AnyResult>;

/**
 * Subcommand value type (either a command or a lazy-loaded command)
 */
export type SubCommandValue = AnyCommand | (() => Promise<AnyCommand>);

/**
 * Record of subcommands indexed by name
 */
export type SubCommandsRecord = Record<string, SubCommandValue>;

/**
 * Options for runMain (CLI entry point)
 */
export interface MainOptions {
  /** Command version */
  version?: string;
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
  /** Capture console output during execution (default: false) */
  captureLogs?: boolean;
  /** Skip command definition validation (useful in production where tests already verified) */
  skipValidation?: boolean;
  /** Custom logger for output (default: console) */
  logger?: Logger;
  /** Global arguments schema (available to all subcommands) */
  globalArgs?: ArgsSchema | undefined;
}

/**
 * Options for runCommand (programmatic/test usage)
 */
export interface RunCommandOptions {
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
  /** Capture console output during execution (default: false) */
  captureLogs?: boolean;
  /** Skip command definition validation (useful in production where tests already verified) */
  skipValidation?: boolean;
  /** Custom logger for output (default: console) */
  logger?: Logger;
  /** Global arguments schema (available to all subcommands) */
  globalArgs?: ArgsSchema | undefined;
}

/**
 * Context for global arguments (passed through command hierarchy)
 * @internal
 */
export interface GlobalArgsContext {
  /** Global arguments schema */
  schema: ArgsSchema;
  /** Parsed global argument values (reused across subcommands) */
  values?: Record<string, unknown> | undefined;
}

/**
 * Internal options for command execution (not exported)
 * @internal
 */
export interface InternalRunOptions {
  /** Custom argv */
  argv?: string[] | undefined;
  /** Show subcommands in help */
  showSubcommands?: boolean | undefined;
  /** Show subcommand options in help */
  showSubcommandOptions?: boolean | undefined;
  /** Handle signals (SIGINT, SIGTERM) */
  handleSignals?: boolean | undefined;
  /** Enable debug mode */
  debug?: boolean | undefined;
  /** Capture console output */
  captureLogs?: boolean | undefined;
  /** Skip command definition validation */
  skipValidation?: boolean | undefined;
  /** Custom logger for output */
  logger?: Logger | undefined;
  /** Global arguments context (internal use) */
  _globalArgsContext?: GlobalArgsContext | undefined;
}

/**
 * Log level type
 */
export type LogLevel = "log" | "info" | "debug" | "warn" | "error";

/**
 * Output stream type
 */
export type LogStream = "stdout" | "stderr";

/**
 * A single log entry collected during command execution
 */
export interface LogEntry {
  /** Log message */
  message: string;
  /** Timestamp when the log was recorded */
  timestamp: Date;
  /** Log level */
  level: LogLevel;
  /** Output stream (stdout or stderr) */
  stream: LogStream;
}

/**
 * Collected logs during command execution
 */
export interface CollectedLogs {
  /** All log entries in order */
  entries: LogEntry[];
}

/**
 * Successful command execution result
 */
export interface RunResultSuccess<T = unknown> {
  /** Indicates successful execution */
  success: true;
  /** Command return value */
  result: T | undefined;
  /** Error that occurred during execution */
  error?: never;
  /** Exit code (always 0 for success) */
  exitCode: 0;
  /** Collected logs during execution */
  logs: CollectedLogs;
}

/**
 * Failed command execution result
 */
export interface RunResultFailure {
  /** Indicates failed execution */
  success: false;
  /** Command return value */
  result?: never;
  /** Error that occurred during execution */
  error: Error;
  /** Exit code (non-zero for failure) */
  exitCode: number;
  /** Collected logs during execution */
  logs: CollectedLogs;
}

/**
 * Result of command execution (discriminated union)
 */
export type RunResult<T = unknown> = RunResultSuccess<T> | RunResultFailure;
