import type {
  AnyCommand,
  CleanupContext,
  CollectedLogs,
  RunResult,
  SetupContext,
} from "../types.js";
import { createLogCollector, emptyLogs, mergeLogs } from "./log-collector.js";

/**
 * Options for lifecycle execution
 */
export interface ExecuteLifecycleOptions {
  /** Handle signals (SIGINT, SIGTERM) */
  handleSignals?: boolean | undefined;
  /** Capture console output */
  captureLogs?: boolean | undefined;
  /** Existing logs to include in result (from runCommandInternal) */
  existingLogs?: CollectedLogs | undefined;
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

  const shouldCollectLogs = _options.captureLogs ?? false;
  const collector = shouldCollectLogs ? createLogCollector() : null;
  collector?.start();

  // Type assertion needed because SetupContext/CleanupContext include GlobalArgs
  // At runtime, args already contains merged global args from runner.ts
  const setupContext = {
    args,
  } as SetupContext<unknown>;

  const cleanupContext = {
    args,
    error,
  } as CleanupContext<unknown>;

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

      // Stop log collection before exit
      collector?.stop();

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

  // Stop log collection
  collector?.stop();

  // Merge existing logs with collected logs
  const existingLogs = _options.existingLogs ?? emptyLogs();
  const collectedLogs = collector?.getLogs() ?? emptyLogs();
  const logs = mergeLogs(existingLogs, collectedLogs);

  if (error) {
    return {
      success: false,
      error,
      exitCode: 1,
      logs,
    };
  }

  return {
    success: true,
    result,
    exitCode: 0,
    logs,
  };
}
