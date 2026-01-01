import { runCommand } from "../core/runner.js";
import type { AnyCommand } from "../types.js";
import type { ExampleRunnerFunction, ExampleRunResult } from "./types.js";

/**
 * Options for creating an example runner
 */
export interface CreateExampleRunnerOptions {
  /** Whether to capture stderr output in addition to stdout */
  captureStderr?: boolean;
}

/**
 * Create a default example runner that uses runCommand
 * This runner captures console.log output during command execution
 *
 * @example
 * ```ts
 * await assertDocMatch({
 *   command,
 *   files: { "README.md": [""] },
 *   exampleRunner: createExampleRunner(),
 * });
 * ```
 */
export function createExampleRunner(
  _options: CreateExampleRunnerOptions = {},
): ExampleRunnerFunction {
  return async (command: AnyCommand, args: string[]): Promise<ExampleRunResult> => {
    const outputs: string[] = [];

    // Capture console.log output
    const originalLog = console.log;
    console.log = (...logArgs: unknown[]) => {
      outputs.push(
        logArgs.map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg))).join(" "),
      );
    };

    try {
      const result = await runCommand(command, args);

      return {
        output: outputs.join("\n"),
        success: result.success,
      };
    } finally {
      // Restore console.log
      console.log = originalLog;
    }
  };
}
