import type { AnyCommand, RunResult, RunContext, SetupContext, CleanupContext } from "../types.js";

/**
 * Options for command execution
 */
export interface RunOptions {
  /** Enable debug mode */
  debug?: boolean | undefined;
  /** Handle signals (SIGINT, SIGTERM) */
  handleSignals?: boolean | undefined;
}

/**
 * Run a command with the given arguments
 *
 * Executes the lifecycle: setup → run → cleanup
 *
 * @param command - The command to run
 * @param args - Validated arguments
 * @param rawArgs - Raw CLI arguments
 * @param options - Run options
 * @returns The result of command execution
 */
export async function runCommand<TResult = unknown>(
  command: AnyCommand,
  args: unknown,
  rawArgs: string[],
  _options: RunOptions = {},
): Promise<RunResult<TResult>> {
  let error: Error | undefined;
  let result: TResult | undefined;

  const setupContext: SetupContext<unknown> = {
    args,
    rawArgs,
  };

  const runContext: RunContext<unknown> = {
    args,
    rawArgs,
  };

  try {
    // Execute setup
    if (command.setup) {
      await command.setup(setupContext);
    }

    // Execute run
    if (command.run) {
      result = await command.run(runContext);
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  }

  // Always execute cleanup
  if (command.cleanup) {
    const cleanupContext: CleanupContext<unknown> = {
      args,
      rawArgs,
      error,
    };

    try {
      await command.cleanup(cleanupContext);
    } catch (cleanupError) {
      // If cleanup fails and there was no previous error, use cleanup error
      if (!error) {
        error = cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError));
      }
    }
  }

  return {
    result,
    exitCode: error ? 1 : 0,
  };
}
