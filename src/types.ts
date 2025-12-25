import type { z } from "zod";

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
 * Command configuration options
 */
export interface CommandConfig<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TResult = void,
> {
  /** Command name (required) */
  name: string;
  /** Command description */
  description?: string;
  /** Argument schema (ZodObject, ZodDiscriminatedUnion, etc.) */
  args?: TArgsSchema;
  /** Subcommands (supports lazy loading) */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands?: Record<string, Command<any, any> | (() => Promise<Command<any, any>>)>;
  /** Setup hook called before run */
  setup?: (
    context: SetupContext<
      TArgsSchema extends z.ZodType ? z.infer<TArgsSchema> : Record<string, never>
    >,
  ) => void | Promise<void>;
  /** Main run function */
  run?: (
    args: TArgsSchema extends z.ZodType ? z.infer<TArgsSchema> : Record<string, never>,
  ) => TResult;
  /** Cleanup hook called after run */
  cleanup?: (
    context: CleanupContext<
      TArgsSchema extends z.ZodType ? z.infer<TArgsSchema> : Record<string, never>
    >,
  ) => void | Promise<void>;
}

/**
 * Base command interface (shared properties)
 */
export interface CommandBase<TArgs = unknown> {
  /** Command name (required) */
  name: string;
  /** Command description */
  description?: string | undefined;
  /** Argument schema */
  argsSchema?: ArgsSchema | undefined;
  /** Subcommands */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands?: Record<string, Command<any, any> | (() => Promise<Command<any, any>>)> | undefined;
  /** Setup hook */
  setup?: ((context: SetupContext<TArgs>) => void | Promise<void>) | undefined;
  /** Cleanup hook */
  cleanup?: ((context: CleanupContext<TArgs>) => void | Promise<void>) | undefined;
}

/**
 * A command with a run function
 */
export interface RunnableCommand<TArgs = unknown, TResult = unknown> extends CommandBase<TArgs> {
  /** Main run function */
  run: (args: TArgs) => TResult;
}

/**
 * A command without a run function (e.g., subcommand-only parent)
 */
export interface NonRunnableCommand<TArgs = unknown> extends CommandBase<TArgs> {
  /** No run function */
  run?: undefined;
}

/**
 * A defined command (union of runnable and non-runnable)
 */
export type Command<TArgs = unknown, TResult = unknown> =
  | RunnableCommand<TArgs, TResult>
  | NonRunnableCommand<TArgs>;

/**
 * Command type that accepts any args/result types
 * Used in internal functions that don't need specific type information
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any>;

/**
 * Options for runMain (CLI entry point)
 */
export interface MainOptions {
  /** Command version */
  version?: string;
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
}

/**
 * Options for runCommand (programmatic/test usage)
 */
export interface RunCommandOptions {
  /** Enable debug mode (show stack traces on errors) */
  debug?: boolean;
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
}

/**
 * Result of command execution
 */
export interface RunResult<T = unknown> {
  /** Command return value */
  result?: T | undefined;
  /** Exit code */
  exitCode: number;
}
