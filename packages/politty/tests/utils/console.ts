import { vi } from "vitest";

export type ConsoleSpy = ReturnType<typeof vi.spyOn> & {
  log: (...args: unknown[]) => void;
  getLogs: () => string[];
};

export type ConsoleErrorSpy = ReturnType<typeof vi.spyOn> & {
  error: (...args: unknown[]) => void;
  getLogs: () => string[];
};

const formatConsoleArg = (arg: unknown): string => {
  if (typeof arg === "string") return arg;
  if (typeof arg === "number" || typeof arg === "boolean" || typeof arg === "bigint") {
    return String(arg);
  }
  if (typeof arg === "symbol") return arg.toString();
  if (arg === null || arg === undefined) return String(arg);
  if (arg instanceof Error) return arg.stack ?? arg.message;
  if (typeof arg === "function") return "[Function]";
  if (typeof arg === "object") {
    try {
      return JSON.stringify(arg);
    } catch {
      return String(arg);
    }
  }
  return String(arg);
};

export const spyOnConsoleLog = (): ConsoleSpy => {
  const originalLog = console.log.bind(console);
  const logs: string[] = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(formatConsoleArg).join(" "));
    originalLog(...args);
  }) as ConsoleSpy;

  spy.log = (...args: unknown[]) => {
    console.log(...args);
  };

  spy.getLogs = () => logs;

  return spy as ConsoleSpy;
};

export const spyOnConsoleError = (): ConsoleErrorSpy => {
  const logs: string[] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(formatConsoleArg).join(" "));
  }) as ConsoleErrorSpy;

  spy.error = (...args: unknown[]) => {
    console.error(...args);
  };

  spy.getLogs = () => logs;

  return spy as ConsoleErrorSpy;
};
