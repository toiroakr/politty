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

  const cleanupContext: CleanupContext<unknown> = {
    args,
    rawArgs,
    error,
  };

  // Signal handler
  let signalHandler: ((signal: NodeJS.Signals) => Promise<void>) | undefined;

  if (_options.handleSignals) {
    signalHandler = async (_signal: NodeJS.Signals) => {
      // Remove listeners to prevent multiple calls
      if (signalHandler) {
        process.off("SIGINT", signalHandler);
        process.off("SIGTERM", signalHandler);
      }

      // Run cleanup
      if (command.cleanup) {
        try {
          // Update error in context if needed, though usually signal is the cause
          // We don't set 'error' here because it might overwrite a real error if we were in a catch block?
          // But here we are interrupting.
          await command.cleanup(cleanupContext);
        } catch (e) {
          console.error("Error during signal cleanup:", e);
        }
      }

      // Exit
      process.exit(1);
    };

    process.on("SIGINT", signalHandler);
    process.on("SIGTERM", signalHandler);
  }

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
  } finally {
    // Remove signal listeners
    if (signalHandler) {
      process.off("SIGINT", signalHandler);
      process.off("SIGTERM", signalHandler);
    }
  }

  // Always execute cleanup
  if (command.cleanup) {
    // Update error in context
    cleanupContext.error = error;

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
