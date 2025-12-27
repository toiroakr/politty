import type { CollectedLogs, LogEntry } from "../types.js";

/**
 * Log collector that intercepts console.error and console.warn
 */
export interface LogCollector {
  /** Get collected logs */
  getLogs: () => CollectedLogs;
  /** Start collecting logs */
  start: () => void;
  /** Stop collecting and restore original console methods */
  stop: () => void;
}

/**
 * Create a log collector that intercepts console.error and console.warn
 *
 * @returns A log collector instance
 *
 * @example
 * ```ts
 * const collector = createLogCollector();
 * collector.start();
 *
 * console.error("Something went wrong");
 * console.warn("This is a warning");
 *
 * collector.stop();
 * const logs = collector.getLogs();
 * // {
 * //   errors: [{ message: "Something went wrong", timestamp: ... }],
 * //   warnings: [{ message: "This is a warning", timestamp: ... }]
 * // }
 * ```
 */
export function createLogCollector(): LogCollector {
  const errors: LogEntry[] = [];
  const warnings: LogEntry[] = [];
  let originalError: typeof console.error | null = null;
  let originalWarn: typeof console.warn | null = null;

  const formatArgs = (args: unknown[]): string => {
    return args
      .map((arg) => {
        if (arg instanceof Error) {
          return arg.message;
        }
        if (typeof arg === "object" && arg !== null) {
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(" ");
  };

  const createInterceptor = (target: LogEntry[], original: typeof console.error) => {
    return (...args: unknown[]) => {
      target.push({
        message: formatArgs(args),
        timestamp: new Date(),
      });
      // Still call the original method
      original.apply(console, args);
    };
  };

  return {
    getLogs() {
      return { errors, warnings };
    },
    start() {
      if (originalError !== null) {
        // Already started
        return;
      }
      originalError = console.error;
      originalWarn = console.warn;
      console.error = createInterceptor(errors, originalError);
      console.warn = createInterceptor(warnings, originalWarn);
    },
    stop() {
      if (originalError !== null) {
        console.error = originalError;
        originalError = null;
      }
      if (originalWarn !== null) {
        console.warn = originalWarn;
        originalWarn = null;
      }
    },
  };
}

/**
 * Merge multiple CollectedLogs into one
 */
export function mergeLogs(...logsArray: CollectedLogs[]): CollectedLogs {
  return {
    errors: logsArray.flatMap((l) => l.errors),
    warnings: logsArray.flatMap((l) => l.warnings),
  };
}

/**
 * Create an empty CollectedLogs object
 */
export function emptyLogs(): CollectedLogs {
  return { errors: [], warnings: [] };
}
