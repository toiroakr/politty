import type { AnyCommand, RunResult, SetupContext, CleanupContext } from "../types.js";

/**
 * Options for lifecycle execution
 */
export interface ExecuteLifecycleOptions {
  /** Handle signals (SIGINT, SIGTERM) */
  handleSignals?: boolean | undefined;
}

/**
 * Execute a command lifecycle: setup → run → cleanup
 *
 * This is an internal function that executes the command's lifecycle hooks.
 * For running commands with argument parsing, use `runCommand` instead.
 *
 * @param command - The command to execute
 * @param args - Already validated arguments
 * @param options - Lifecycle options
 * @returns The result of command execution
 * @internal
 */
export async function executeLifecycle<TResult = unknown>(
  command: AnyCommand,
  args: unknown,
  _options: ExecuteLifecycleOptions = {},
): Promise<RunResult<TResult>> {
  let error: Error | undefined;
  let result: TResult | undefined;

  const setupContext: SetupContext<unknown> = {
    args,
  };

  const cleanupContext: CleanupContext<unknown> = {
    args,
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
      result = await command.run(args);
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
