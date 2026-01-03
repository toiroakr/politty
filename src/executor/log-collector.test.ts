import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCommand, runCommand } from "../index.js";
import { createLogCollector, emptyLogs, mergeLogs } from "./log-collector.js";

describe("createLogCollector", () => {
  let originalLog: typeof console.log;
  let originalInfo: typeof console.info;
  let originalDebug: typeof console.debug;
  let originalWarn: typeof console.warn;
  let originalError: typeof console.error;

  beforeEach(() => {
    originalLog = console.log;
    originalInfo = console.info;
    originalDebug = console.debug;
    originalWarn = console.warn;
    originalError = console.error;
  });

  afterEach(() => {
    console.log = originalLog;
    console.info = originalInfo;
    console.debug = originalDebug;
    console.warn = originalWarn;
    console.error = originalError;
  });

  it("should collect console.log calls", () => {
    const collector = createLogCollector();
    collector.start();

    console.log("Test log message");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]!.message).toBe("Test log message");
    expect(logs.entries[0]!.level).toBe("log");
    expect(logs.entries[0]!.stream).toBe("stdout");
    expect(logs.entries[0]!.timestamp).toBeInstanceOf(Date);
  });

  it("should collect console.error calls", () => {
    const collector = createLogCollector();
    collector.start();

    console.error("Test error message");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]!.message).toBe("Test error message");
    expect(logs.entries[0]!.level).toBe("error");
    expect(logs.entries[0]!.stream).toBe("stderr");
    expect(logs.entries[0]!.timestamp).toBeInstanceOf(Date);
  });

  it("should collect console.warn calls", () => {
    const collector = createLogCollector();
    collector.start();

    console.warn("Test warning message");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]!.message).toBe("Test warning message");
    expect(logs.entries[0]!.level).toBe("warn");
    expect(logs.entries[0]!.stream).toBe("stderr");
    expect(logs.entries[0]!.timestamp).toBeInstanceOf(Date);
  });

  it("should collect console.info calls", () => {
    const collector = createLogCollector();
    collector.start();

    console.info("Test info message");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]!.message).toBe("Test info message");
    expect(logs.entries[0]!.level).toBe("info");
    expect(logs.entries[0]!.stream).toBe("stdout");
  });

  it("should collect console.debug calls", () => {
    const collector = createLogCollector();
    collector.start();

    console.debug("Test debug message");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries).toHaveLength(1);
    expect(logs.entries[0]!.message).toBe("Test debug message");
    expect(logs.entries[0]!.level).toBe("debug");
    expect(logs.entries[0]!.stream).toBe("stdout");
  });

  it("should collect multiple logs and preserve order", () => {
    const collector = createLogCollector();
    collector.start();

    console.log("Log 1");
    console.error("Error 1");
    console.warn("Warning 1");
    console.log("Log 2");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries).toHaveLength(4);
    expect(logs.entries[0]!.message).toBe("Log 1");
    expect(logs.entries[0]!.level).toBe("log");
    expect(logs.entries[1]!.message).toBe("Error 1");
    expect(logs.entries[1]!.level).toBe("error");
    expect(logs.entries[2]!.message).toBe("Warning 1");
    expect(logs.entries[2]!.level).toBe("warn");
    expect(logs.entries[3]!.message).toBe("Log 2");
    expect(logs.entries[3]!.level).toBe("log");
  });

  it("should format multiple arguments as space-separated string", () => {
    const collector = createLogCollector();
    collector.start();

    console.error("Error:", "code", 123);

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries[0]!.message).toBe("Error: code 123");
  });

  it("should format Error objects using their message", () => {
    const collector = createLogCollector();
    collector.start();

    console.error(new Error("Something went wrong"));

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries[0]!.message).toBe("Something went wrong");
  });

  it("should format objects as JSON", () => {
    const collector = createLogCollector();
    collector.start();

    console.error({ key: "value", num: 42 });

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries[0]!.message).toBe('{"key":"value","num":42}');
  });

  it("should still call original console methods by default", () => {
    const mockLog = vi.fn();
    const mockError = vi.fn();
    const mockWarn = vi.fn();
    console.log = mockLog;
    console.error = mockError;
    console.warn = mockWarn;

    const collector = createLogCollector();
    collector.start();

    console.log("Test log");
    console.error("Test error");
    console.warn("Test warning");

    collector.stop();

    expect(mockLog).toHaveBeenCalledWith("Test log");
    expect(mockError).toHaveBeenCalledWith("Test error");
    expect(mockWarn).toHaveBeenCalledWith("Test warning");
  });

  it("should not call original console methods when passthrough is false", () => {
    const mockLog = vi.fn();
    const mockError = vi.fn();
    console.log = mockLog;
    console.error = mockError;

    const collector = createLogCollector({ passthrough: false });
    collector.start();

    console.log("Test log");
    console.error("Test error");

    collector.stop();

    expect(mockLog).not.toHaveBeenCalled();
    expect(mockError).not.toHaveBeenCalled();

    // But logs should still be collected
    const logs = collector.getLogs();
    expect(logs.entries).toHaveLength(2);
  });

  it("should only capture specified levels when levels option is provided", () => {
    const collector = createLogCollector({ levels: ["error", "warn"] });
    collector.start();

    console.log("This should not be captured");
    console.error("This should be captured");
    console.warn("This should also be captured");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.entries).toHaveLength(2);
    expect(logs.entries[0]!.level).toBe("error");
    expect(logs.entries[1]!.level).toBe("warn");
  });

  it("should restore original console methods after stop", () => {
    const mockError = vi.fn();
    console.error = mockError;

    const collector = createLogCollector();
    collector.start();

    const interceptedError = console.error;
    expect(interceptedError).not.toBe(mockError);

    collector.stop();
    expect(console.error).toBe(mockError);
  });

  it("should not double-start if already started", () => {
    const collector = createLogCollector();
    collector.start();
    const firstInterceptor = console.error;

    collector.start(); // Second start should be ignored
    expect(console.error).toBe(firstInterceptor);

    collector.stop();
  });
});

describe("emptyLogs", () => {
  it("should return empty entries array", () => {
    const logs = emptyLogs();
    expect(logs.entries).toEqual([]);
  });
});

describe("mergeLogs", () => {
  it("should merge multiple log collections and sort by timestamp", () => {
    const time1 = new Date("2024-01-01T00:00:00");
    const time2 = new Date("2024-01-01T00:00:01");
    const time3 = new Date("2024-01-01T00:00:02");
    const time4 = new Date("2024-01-01T00:00:03");

    const logs1 = {
      entries: [
        { message: "Log 1", timestamp: time1, level: "log" as const, stream: "stdout" as const },
        { message: "Log 3", timestamp: time3, level: "error" as const, stream: "stderr" as const },
      ],
    };
    const logs2 = {
      entries: [
        { message: "Log 2", timestamp: time2, level: "warn" as const, stream: "stderr" as const },
        { message: "Log 4", timestamp: time4, level: "log" as const, stream: "stdout" as const },
      ],
    };

    const merged = mergeLogs(logs1, logs2);

    expect(merged.entries).toHaveLength(4);
    expect(merged.entries[0]!.message).toBe("Log 1");
    expect(merged.entries[1]!.message).toBe("Log 2");
    expect(merged.entries[2]!.message).toBe("Log 3");
    expect(merged.entries[3]!.message).toBe("Log 4");
  });

  it("should handle empty collections", () => {
    const logs1 = emptyLogs();
    const logs2 = {
      entries: [
        {
          message: "Error",
          timestamp: new Date(),
          level: "error" as const,
          stream: "stderr" as const,
        },
      ],
    };

    const merged = mergeLogs(logs1, logs2);

    expect(merged.entries).toHaveLength(1);
  });
});

describe("runCommand with log collection", () => {
  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "debug").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not collect logs when captureLogs is false (default)", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {
        console.log("Log from command");
        console.error("Error from command");
        console.warn("Warning from command");
      },
    });

    const result = await runCommand(command, []);

    // Default: no log collection
    expect(result.logs.entries).toHaveLength(0);
  });

  it("should collect all log levels when captureLogs is true", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {
        console.log("Log from command");
        console.error("Error from command");
        console.warn("Warning from command");
      },
    });

    const result = await runCommand(command, [], { captureLogs: true });

    expect(result.logs.entries).toHaveLength(3);
    expect(result.logs.entries[0]!.message).toBe("Log from command");
    expect(result.logs.entries[0]!.level).toBe("log");
    expect(result.logs.entries[1]!.message).toBe("Error from command");
    expect(result.logs.entries[1]!.level).toBe("error");
    expect(result.logs.entries[2]!.message).toBe("Warning from command");
    expect(result.logs.entries[2]!.level).toBe("warn");
  });

  it("should collect logs from setup hook", async () => {
    const command = defineCommand({
      name: "test",
      setup: () => {
        console.error("Error from setup");
      },
      run: () => {},
    });

    const result = await runCommand(command, [], { captureLogs: true });

    const errors = result.logs.entries.filter((e) => e.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("Error from setup");
  });

  it("should collect logs from cleanup hook", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {},
      cleanup: () => {
        console.warn("Warning from cleanup");
      },
    });

    const result = await runCommand(command, [], { captureLogs: true });

    const warnings = result.logs.entries.filter((e) => e.level === "warn");
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.message).toBe("Warning from cleanup");
  });

  it("should collect logs on validation error", async () => {
    const command = defineCommand({
      name: "test",
      args: z.object({
        required: z.string(),
      }),
      run: () => {},
    });

    const result = await runCommand(command, [], { captureLogs: true });

    // Validation error logs should be collected
    expect(result.success).toBe(false);
    const errors = result.logs.entries.filter((e) => e.level === "error");
    expect(errors.length).toBeGreaterThan(0);
  });

  it("should collect logs across subcommand routing", async () => {
    const subCommand = defineCommand({
      name: "sub",
      run: () => {
        console.error("Error from subcommand");
      },
    });

    const command = defineCommand({
      name: "main",
      subCommands: { sub: subCommand },
    });

    const result = await runCommand(command, ["sub"], { captureLogs: true });

    const errors = result.logs.entries.filter((e) => e.level === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("Error from subcommand");
  });

  it("should capture stdout logs (console.log)", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {
        console.log("This is now collected");
      },
    });

    const result = await runCommand(command, [], { captureLogs: true });

    const stdoutLogs = result.logs.entries.filter((e) => e.stream === "stdout");
    expect(stdoutLogs).toHaveLength(1);
    expect(stdoutLogs[0]!.message).toBe("This is now collected");
  });
});
