import type {
  AnyCommand,
  CleanupContext,
  CollectedLogs,
  GlobalCleanupContext,
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
  /** Global cleanup hook to run on signal interruption (after per-command cleanup) */
  globalCleanup?: ((context: GlobalCleanupContext) => void | Promise<void>) | undefined;
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

      const signalError = new Error("Process interrupted");

      // Run per-command cleanup
      if (command.cleanup) {
        try {
          await command.cleanup(cleanupContext);
        } catch (e) {
          console.error("Error during signal cleanup:", e);
        }
      }

      // Run global cleanup
      if (_options.globalCleanup) {
        try {
          await _options.globalCleanup({ error: signalError });
        } catch (e) {
          console.error("Error during global signal cleanup:", e);
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
