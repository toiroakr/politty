import type { z } from "zod";

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
  /** Parsed and validated arguments */
  args: TArgs;
}

/**
 * Context provided to cleanup function
 */
export interface CleanupContext<TArgs = unknown> {
  /** Parsed and validated arguments */
  args: TArgs;
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands?:
    | Record<string, Command<any, any, any> | (() => Promise<Command<any, any, any>>)>
    | undefined;
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
  /** Main run function */
  run: (args: TArgs) => TResult;
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
 * Command type that accepts any args/result types
 * Used in internal functions that don't need specific type information
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any, any>;

/**
 * Options for runMain (CLI entry point)
 */
export interface MainOptions {
  /** Command version */
  version?: string;
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
  /** Capture console.error and console.warn output during execution (default: false) */
  captureErrorLogs?: boolean;
  /** Skip command definition validation (useful in production where tests already verified) */
  skipValidation?: boolean;
  /** Custom logger for output (default: console) */
  logger?: Logger;
}

/**
 * Options for runCommand (programmatic/test usage)
 */
export interface RunCommandOptions {
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
  /** Capture console.error and console.warn output during execution (default: false) */
  captureErrorLogs?: boolean;
  /** Skip command definition validation (useful in production where tests already verified) */
  skipValidation?: boolean;
  /** Custom logger for output (default: console) */
  logger?: Logger;
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
  /** Capture console.error and console.warn output */
  captureErrorLogs?: boolean | undefined;
  /** Skip command definition validation */
  skipValidation?: boolean | undefined;
  /** Custom logger for output */
  logger?: Logger | undefined;
}

/**
 * A single log entry collected during command execution
 */
export interface LogEntry {
  /** Log message */
  message: string;
  /** Timestamp when the log was recorded */
  timestamp: Date;
}

/**
 * Collected logs during command execution
 */
export interface CollectedLogs {
  /** Error logs (console.error) */
  errors: LogEntry[];
  /** Warning logs (console.warn) */
  warnings: LogEntry[];
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
