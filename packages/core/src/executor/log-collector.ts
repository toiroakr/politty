import { StringDecoder } from "node:string_decoder";
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
 * Log collector that intercepts console methods and process stream writes
 */
export interface LogCollector {
  /** Get collected logs */
  getLogs: () => CollectedLogs;
  /** Start collecting logs */
  start: () => void;
  /** Stop collecting and restore original console methods and stream writes */
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
 * Strip a single trailing newline (LF or CRLF) from a stream-write chunk,
 * so it lines up with console entries (which never carry one).
 */
function stripTrailingNewline(message: string): string {
  return message.replace(/\r?\n$/, "");
}

type StreamWrite = typeof process.stdout.write;

/**
 * Create a log collector that intercepts console methods and process stream writes
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
 *
 * Output written directly via `process.stdout.write` / `process.stderr.write`
 * (bypassing `console.*`) is captured too, as long as the corresponding
 * `"log"` / `"error"` level is included in `levels`. Note that this stream
 * patch is independent of the other console levels: e.g. with
 * `levels: ["log"]`, `console.info` is not intercepted at the console layer,
 * but its underlying `process.stdout.write` call still is, so it is recorded
 * with `level: "log"`.
 */
export function createLogCollector(options: LogCollectorOptions = {}): LogCollector {
  const entries: LogEntry[] = [];
  const levels = options.levels ?? ALL_LOG_LEVELS;
  const passthrough = options.passthrough ?? true;

  let originals: Record<LogLevel, typeof console.log> | null = null;
  let originalStdoutWrite: StreamWrite | null = null;
  let originalStderrWrite: StreamWrite | null = null;

  // console.* methods write to process.stdout/stderr internally; this flag
  // stops the stream-write interceptor from double-recording that nested call.
  let inConsoleCall = false;

  const recordEntry = (level: LogLevel, stream: LogStream, message: string) => {
    entries.push({ message, timestamp: new Date(), level, stream });
  };

  const createInterceptor = (level: LogLevel, original: typeof console.log) => {
    return (...args: unknown[]) => {
      recordEntry(level, LOG_STREAM_MAP[level], formatArgs(args));
      inConsoleCall = true;
      try {
        if (passthrough) {
          original.apply(console, args);
        }
      } finally {
        inConsoleCall = false;
      }
    };
  };

  const createWriteInterceptor = (
    level: LogLevel,
    stream: LogStream,
    original: StreamWrite,
  ): StreamWrite => {
    // Buffers incomplete multi-byte sequences across calls (e.g. a UTF-8
    // character split across two writes), so decoding stays correct.
    const decoder = new StringDecoder("utf8");

    return ((chunk: unknown, encodingOrCallback?: unknown, callback?: unknown) => {
      if (!inConsoleCall) {
        // Node's `encoding` argument only ever applies to string chunks (it
        // converts the string to bytes before writing); for a Buffer/Uint8Array
        // chunk it's ignored entirely, so decoding must be too.
        const message =
          typeof chunk === "string"
            ? typeof encodingOrCallback === "string" &&
              encodingOrCallback !== "utf8" &&
              encodingOrCallback !== "utf-8"
              ? Buffer.from(chunk, encodingOrCallback as BufferEncoding).toString("utf8")
              : chunk
            : decoder.write(chunk as Uint8Array);
        if (message !== "") {
          recordEntry(level, stream, stripTrailingNewline(message));
        }
      }
      if (passthrough) {
        return original.call(
          process[stream],
          chunk as never,
          encodingOrCallback as never,
          callback as never,
        );
      }
      const done = typeof encodingOrCallback === "function" ? encodingOrCallback : callback;
      if (typeof done === "function") {
        done();
      }
      return true;
    }) as StreamWrite;
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
      if (levels.includes("log")) {
        originalStdoutWrite = process.stdout.write;
        process.stdout.write = createWriteInterceptor("log", "stdout", originalStdoutWrite);
      }
      if (levels.includes("error")) {
        originalStderrWrite = process.stderr.write;
        process.stderr.write = createWriteInterceptor("error", "stderr", originalStderrWrite);
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
      if (originalStdoutWrite !== null) {
        process.stdout.write = originalStdoutWrite;
        originalStdoutWrite = null;
      }
      if (originalStderrWrite !== null) {
        process.stderr.write = originalStderrWrite;
        originalStderrWrite = null;
      }
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
