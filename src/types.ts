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
  /** Raw CLI arguments */
  rawArgs: string[];
}

/**
 * Context provided to run function
 */
export interface RunContext<TArgs = unknown> {
  /** Parsed and validated arguments */
  args: TArgs;
  /** Raw CLI arguments */
  rawArgs: string[];
}

/**
 * Context provided to cleanup function
 */
export interface CleanupContext<TArgs = unknown> {
  /** Parsed and validated arguments */
  args: TArgs;
  /** Raw CLI arguments */
  rawArgs: string[];
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
  /** Command name */
  name?: string;
  /** Command version */
  version?: string;
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
    context: RunContext<
      TArgsSchema extends z.ZodType ? z.infer<TArgsSchema> : Record<string, never>
    >,
  ) => TResult | Promise<TResult>;
  /** Cleanup hook called after run */
  cleanup?: (
    context: CleanupContext<
      TArgsSchema extends z.ZodType ? z.infer<TArgsSchema> : Record<string, never>
    >,
  ) => void | Promise<void>;
}

/**
 * A defined command
 */
export interface Command<TArgs = unknown, TResult = unknown> {
  /** Command name */
  name?: string | undefined;
  /** Command version */
  version?: string | undefined;
  /** Command description */
  description?: string | undefined;
  /** Argument schema */
  argsSchema?: ArgsSchema | undefined;
  /** Subcommands */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands?: Record<string, Command<any, any> | (() => Promise<Command<any, any>>)> | undefined;
  /** Setup hook */
  setup?: ((context: SetupContext<TArgs>) => void | Promise<void>) | undefined;
  /** Main run function */
  run?: ((context: RunContext<TArgs>) => TResult | Promise<TResult>) | undefined;
  /** Cleanup hook */
  cleanup?: ((context: CleanupContext<TArgs>) => void | Promise<void>) | undefined;
}

/**
 * Command type that accepts any args/result types
 * Used in internal functions that don't need specific type information
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyCommand = Command<any, any>;

/**
 * Options for runMain
 */
export interface MainOptions {
  /** Show subcommands in help */
  showSubcommands?: boolean;
  /** Show subcommand options in help */
  showSubcommandOptions?: boolean;
  /** Enable debug mode */
  debug?: boolean;
  /** Handle signals (SIGINT, SIGTERM) */
  handleSignals?: boolean;
  /** Custom argv (defaults to process.argv.slice(2)) */
  argv?: string[];
  /** Automatically call process.exit with exit code (defaults to true) */
  exit?: boolean;
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
