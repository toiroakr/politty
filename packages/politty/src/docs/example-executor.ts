import { createLogCollector } from "../executor/log-collector.js";
import type { AnyCommand, Example } from "../types.js";
import type { ExampleCommandConfig, ExampleExecutionResult } from "./types.js";

/**
 * Execute examples for a command and capture output
 *
 * @param examples - Examples to execute
 * @param config - Execution configuration (mock setup/cleanup)
 * @param rootCommand - Root command to execute against
 * @param commandPath - Command path for subcommands (e.g., ["config", "get"])
 * @returns Array of execution results with captured stdout/stderr
 */
export async function executeExamples(
  examples: Example[],
  config: ExampleCommandConfig,
  rootCommand: AnyCommand,
  commandPath: string[] = [],
): Promise<ExampleExecutionResult[]> {
  const results: ExampleExecutionResult[] = [];

  // Setup mock if provided
  if (config.mock) {
    await config.mock();
  }

  try {
    for (const example of examples) {
      const result = await executeSingleExample(example, rootCommand, commandPath);
      results.push(result);
    }
  } finally {
    // Cleanup mock if provided
    if (config.cleanup) {
      await config.cleanup();
    }
  }

  return results;
}

/**
 * Execute a single example and capture output
 */
async function executeSingleExample(
  example: Example,
  rootCommand: AnyCommand,
  commandPath: string[],
): Promise<ExampleExecutionResult> {
  // Parse command string into argv
  const exampleArgs = parseExampleCmd(example.cmd);

  // Build full argv: command path + example args
  const argv = [...commandPath, ...exampleArgs];

  // Use unified log collector (don't passthrough to console)
  const collector = createLogCollector({ passthrough: false });
  collector.start();

  let success = true;
  try {
    // Import runCommand dynamically to avoid circular dependency
    const { runCommand } = await import("../core/runner.js");
    const result = await runCommand(rootCommand, argv);
    success = result.success;

    // Also capture any errors from the result
    if (!result.success && result.error) {
      console.error(result.error.message);
    }
  } catch (error) {
    success = false;
    console.error(error instanceof Error ? error.message : String(error));
  } finally {
    collector.stop();
  }

  // Convert entries to stdout/stderr strings
  const logs = collector.getLogs();
  const stdout = logs.entries
    .filter((e) => e.stream === "stdout")
    .map((e) => e.message)
    .join("\n");
  const stderr = logs.entries
    .filter((e) => e.stream === "stderr")
    .map((e) => e.message)
    .join("\n");

  return {
    cmd: example.cmd,
    desc: example.desc,
    expectedOutput: example.output,
    stdout,
    stderr,
    success,
  };
}

/**
 * Parse example command string into argv array
 * Handles quoted strings (single and double quotes)
 *
 * @example
 * parseExampleCmd('World') // ['World']
 * parseExampleCmd('--name "John Doe"') // ['--name', 'John Doe']
 * parseExampleCmd("--greeting 'Hello World'") // ['--greeting', 'Hello World']
 */
function parseExampleCmd(cmd: string): string[] {
  const args: string[] = [];
  let current = "";
  let inQuote = false;
  let quoteChar = "";

  for (let i = 0; i < cmd.length; i++) {
    const char = cmd[i]!;

    if ((char === '"' || char === "'") && !inQuote) {
      inQuote = true;
      quoteChar = char;
    } else if (char === quoteChar && inQuote) {
      inQuote = false;
      quoteChar = "";
    } else if (char === " " && !inQuote) {
      if (current) {
        args.push(current);
        current = "";
      }
    } else {
      current += char;
    }
  }

  if (current) {
    args.push(current);
  }

  return args;
}
