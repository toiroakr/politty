import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { defineCommand, runCommand } from "../index.js";
import { createLogCollector, emptyLogs, mergeLogs } from "./log-collector.js";

describe("createLogCollector", () => {
  let originalError: typeof console.error;
  let originalWarn: typeof console.warn;

  beforeEach(() => {
    originalError = console.error;
    originalWarn = console.warn;
  });

  afterEach(() => {
    console.error = originalError;
    console.warn = originalWarn;
  });

  it("should collect console.error calls", () => {
    const collector = createLogCollector();
    collector.start();

    console.error("Test error message");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.errors).toHaveLength(1);
    expect(logs.errors[0]!.message).toBe("Test error message");
    expect(logs.errors[0]!.timestamp).toBeInstanceOf(Date);
    expect(logs.warnings).toHaveLength(0);
  });

  it("should collect console.warn calls", () => {
    const collector = createLogCollector();
    collector.start();

    console.warn("Test warning message");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.warnings).toHaveLength(1);
    expect(logs.warnings[0]!.message).toBe("Test warning message");
    expect(logs.warnings[0]!.timestamp).toBeInstanceOf(Date);
    expect(logs.errors).toHaveLength(0);
  });

  it("should collect multiple logs", () => {
    const collector = createLogCollector();
    collector.start();

    console.error("Error 1");
    console.warn("Warning 1");
    console.error("Error 2");
    console.warn("Warning 2");

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.errors).toHaveLength(2);
    expect(logs.warnings).toHaveLength(2);
    expect(logs.errors[0]!.message).toBe("Error 1");
    expect(logs.errors[1]!.message).toBe("Error 2");
    expect(logs.warnings[0]!.message).toBe("Warning 1");
    expect(logs.warnings[1]!.message).toBe("Warning 2");
  });

  it("should format multiple arguments as space-separated string", () => {
    const collector = createLogCollector();
    collector.start();

    console.error("Error:", "code", 123);

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.errors[0]!.message).toBe("Error: code 123");
  });

  it("should format Error objects using their message", () => {
    const collector = createLogCollector();
    collector.start();

    console.error(new Error("Something went wrong"));

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.errors[0]!.message).toBe("Something went wrong");
  });

  it("should format objects as JSON", () => {
    const collector = createLogCollector();
    collector.start();

    console.error({ key: "value", num: 42 });

    collector.stop();
    const logs = collector.getLogs();

    expect(logs.errors[0]!.message).toBe('{"key":"value","num":42}');
  });

  it("should still call original console methods", () => {
    const mockError = vi.fn();
    const mockWarn = vi.fn();
    console.error = mockError;
    console.warn = mockWarn;

    const collector = createLogCollector();
    collector.start();

    console.error("Test error");
    console.warn("Test warning");

    collector.stop();

    expect(mockError).toHaveBeenCalledWith("Test error");
    expect(mockWarn).toHaveBeenCalledWith("Test warning");
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
  it("should return empty arrays", () => {
    const logs = emptyLogs();
    expect(logs.errors).toEqual([]);
    expect(logs.warnings).toEqual([]);
  });
});

describe("mergeLogs", () => {
  it("should merge multiple log collections", () => {
    const logs1 = {
      errors: [{ message: "Error 1", timestamp: new Date() }],
      warnings: [{ message: "Warning 1", timestamp: new Date() }],
    };
    const logs2 = {
      errors: [{ message: "Error 2", timestamp: new Date() }],
      warnings: [{ message: "Warning 2", timestamp: new Date() }],
    };

    const merged = mergeLogs(logs1, logs2);

    expect(merged.errors).toHaveLength(2);
    expect(merged.warnings).toHaveLength(2);
    expect(merged.errors[0]!.message).toBe("Error 1");
    expect(merged.errors[1]!.message).toBe("Error 2");
  });

  it("should handle empty collections", () => {
    const logs1 = emptyLogs();
    const logs2 = {
      errors: [{ message: "Error", timestamp: new Date() }],
      warnings: [],
    };

    const merged = mergeLogs(logs1, logs2);

    expect(merged.errors).toHaveLength(1);
    expect(merged.warnings).toHaveLength(0);
  });
});

describe("runCommand with log collection", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not collect logs when captureErrorLogs is false (default)", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {
        console.error("Error from command");
        console.warn("Warning from command");
      },
    });

    const result = await runCommand(command, []);

    // Default: no log collection
    expect(result.logs.errors).toHaveLength(0);
    expect(result.logs.warnings).toHaveLength(0);
  });

  it("should collect logs when captureErrorLogs is true", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {
        console.error("Error from command");
        console.warn("Warning from command");
      },
    });

    const result = await runCommand(command, [], { captureErrorLogs: true });

    expect(result.logs.errors).toHaveLength(1);
    expect(result.logs.warnings).toHaveLength(1);
    expect(result.logs.errors[0]!.message).toBe("Error from command");
    expect(result.logs.warnings[0]!.message).toBe("Warning from command");
  });

  it("should collect logs from setup hook", async () => {
    const command = defineCommand({
      name: "test",
      setup: () => {
        console.error("Error from setup");
      },
      run: () => {},
    });

    const result = await runCommand(command, [], { captureErrorLogs: true });

    expect(result.logs.errors).toHaveLength(1);
    expect(result.logs.errors[0]!.message).toBe("Error from setup");
  });

  it("should collect logs from cleanup hook", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {},
      cleanup: () => {
        console.warn("Warning from cleanup");
      },
    });

    const result = await runCommand(command, [], { captureErrorLogs: true });

    expect(result.logs.warnings).toHaveLength(1);
    expect(result.logs.warnings[0]!.message).toBe("Warning from cleanup");
  });

  it("should collect logs on validation error", async () => {
    const command = defineCommand({
      name: "test",
      args: z.object({
        required: z.string(),
      }),
      run: () => {},
    });

    const result = await runCommand(command, [], { captureErrorLogs: true });

    // Validation error logs should be collected
    expect(result.success).toBe(false);
    expect(result.logs.errors.length).toBeGreaterThan(0);
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

    const result = await runCommand(command, ["sub"], { captureErrorLogs: true });

    expect(result.logs.errors).toHaveLength(1);
    expect(result.logs.errors[0]!.message).toBe("Error from subcommand");
  });

  it("should return empty logs when no errors or warnings", async () => {
    const command = defineCommand({
      name: "test",
      run: () => {
        console.log("This is not collected");
      },
    });

    // Mock console.log separately
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runCommand(command, [], { captureErrorLogs: true });

    expect(result.logs.errors).toHaveLength(0);
    expect(result.logs.warnings).toHaveLength(0);
  });
});
