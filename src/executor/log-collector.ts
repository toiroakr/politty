import type { CollectedLogs, LogEntry, LogLevel, LogStream } from "../types.js";

/**
 * Mapping from log level to output stream
 */
const LOG_STREAM_MAP: Record<LogLevel, LogStream> = {
  log: "stdout",
  info: "stdout",
  debug: "stdout",
  warn: "stderr",
  error: "stderr",
};

/**
 * All log levels
 */
const ALL_LOG_LEVELS: LogLevel[] = ["log", "info", "debug", "warn", "error"];

/**
 * Options for log collector
 */
export interface LogCollectorOptions {
  /** Log levels to capture (default: all) */
  levels?: LogLevel[];
  /** Whether to call original console methods (default: true) */
  passthrough?: boolean;
}

/**
 * Log collector that intercepts console methods
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
 * Format console arguments to string
 */
export function formatArgs(args: unknown[]): string {
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
}

/**
 * Create a log collector that intercepts console methods
 *
 * @param options - Options for the log collector
 * @returns A log collector instance
 *
 * @example
 * ```ts
 * const collector = createLogCollector();
 * collector.start();
 *
 * console.log("Info message");
 * console.error("Something went wrong");
 * console.warn("This is a warning");
 *
 * collector.stop();
 * const logs = collector.getLogs();
 * // {
 * //   entries: [
 * //     { message: "Info message", level: "log", stream: "stdout", timestamp: ... },
 * //     { message: "Something went wrong", level: "error", stream: "stderr", timestamp: ... },
 * //     { message: "This is a warning", level: "warn", stream: "stderr", timestamp: ... }
 * //   ]
 * // }
 * ```
 */
export function createLogCollector(options: LogCollectorOptions = {}): LogCollector {
  const entries: LogEntry[] = [];
  const levels = options.levels ?? ALL_LOG_LEVELS;
  const passthrough = options.passthrough ?? true;

  let originals: Record<LogLevel, typeof console.log> | null = null;

  const createInterceptor = (level: LogLevel, original: typeof console.log) => {
    return (...args: unknown[]) => {
      entries.push({
        message: formatArgs(args),
        timestamp: new Date(),
        level,
        stream: LOG_STREAM_MAP[level],
      });
      if (passthrough) {
        original.apply(console, args);
      }
    };
  };

  return {
    getLogs() {
      return { entries: [...entries] };
    },
    start() {
      if (originals !== null) {
        // Already started
        return;
      }
      originals = {
        log: console.log,
        info: console.info,
        debug: console.debug,
        warn: console.warn,
        error: console.error,
      };
      for (const level of levels) {
        console[level] = createInterceptor(level, originals[level]);
      }
    },
    stop() {
      if (originals === null) {
        return;
      }
      for (const level of levels) {
        console[level] = originals[level];
      }
      originals = null;
    },
  };
}

/**
 * Merge multiple CollectedLogs into one (sorted by timestamp)
 */
export function mergeLogs(...logsArray: CollectedLogs[]): CollectedLogs {
  return {
    entries: logsArray
      .flatMap((l) => l.entries)
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()),
  };
}

/**
 * Create an empty CollectedLogs object
 */
export function emptyLogs(): CollectedLogs {
  return { entries: [] };
}
