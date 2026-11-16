import { getFieldValue } from "../adapter/unflatten.js";
import type { ResolvedFieldMeta } from "../core/schema-extractor.js";
import { loadRequiredPackages } from "../package-requirements.js";
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
  packageFields?: readonly ResolvedFieldMeta[] | undefined;
  packageDiscriminators?: readonly string[] | undefined;
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

  const stopController = new AbortController();
  if (typeof args === "object" && args !== null) {
    Object.defineProperty(args, "$signal", {
      value: stopController.signal,
      enumerable: false,
    });
  }
  let running = false;
  let interruption: Promise<void> | undefined;

  // Signal handler
  let signalHandler: ((signal: NodeJS.Signals) => Promise<void>) | undefined;

  if (_options.handleSignals) {
    const interrupt = async () => {
      // Remove listeners to prevent multiple calls
      if (signalHandler) {
        process.off("SIGINT", signalHandler);
        process.off("SIGTERM", signalHandler);
      }

      const signalError = new Error("Process interrupted");
      cleanupContext.error = signalError;

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

      // Flush stdout before exit to prevent truncated output.
      // Use writableNeedDrain with a timeout to avoid hanging indefinitely.
      if (process.stdout.writableNeedDrain) {
        await new Promise<void>((resolve) => {
          const timeout = setTimeout(() => {
            process.stdout.off("drain", onDrain);
            resolve();
          }, 200);
          const onDrain = () => {
            clearTimeout(timeout);
            resolve();
          };
          process.stdout.once("drain", onDrain);
        });
      }

      // Exit
      process.exit(1);
    };

    signalHandler = (_signal: NodeJS.Signals) => {
      const alreadyStopping = stopController.signal.aborted;
      stopController.abort();
      if (command.gracefulShutdown && running && !alreadyStopping) {
        return Promise.resolve();
      }
      interruption = interrupt();
      return interruption;
    };

    process.on("SIGINT", signalHandler);
    process.on("SIGTERM", signalHandler);
  }

  try {
    if (command.requiredPackages?.length) {
      await loadRequiredPackages(command.requiredPackages, args);
    }
    const packageArgs = (typeof args === "object" && args !== null ? args : {}) as Record<
      string,
      unknown
    >;
    for (const field of _options.packageFields ?? []) {
      if (
        field.requiredPackages?.length &&
        (field.nested
          ? getFieldValue(packageArgs, field) !== undefined
          : field.name in packageArgs) &&
        (_options.packageDiscriminators?.includes(field.name) ||
          getFieldValue(packageArgs, field) === true)
      ) {
        await loadRequiredPackages(field.requiredPackages, args);
      }
    }
    // Execute setup
    if (command.setup && !interruption) {
      await command.setup(setupContext);
    }

    // Execute run
    if (command.run && !interruption) {
      running = true;
      result = await command.run(args);
    }
  } catch (e) {
    error = e instanceof Error ? e : new Error(String(e));
  } finally {
    running = false;
    // Remove signal listeners
    if (signalHandler) {
      process.off("SIGINT", signalHandler);
      process.off("SIGTERM", signalHandler);
    }
  }

  if (interruption) {
    // The interrupt runs cleanup itself and then exits the process
    await interruption;
    error = cleanupContext.error;
  } else if (command.cleanup) {
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
