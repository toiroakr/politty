import { executeLifecycle } from "../executor/command-runner.js";
import { createLogCollector, emptyLogs } from "../executor/log-collector.js";
import { listSubCommands, resolveSubcommand } from "../executor/subcommand-router.js";
import { generateHelp, type CommandContext } from "../output/help-generator.js";
import { parseArgs } from "../parser/arg-parser.js";
import type {
    AnyCommand,
    CollectedLogs,
    InternalRunOptions,
    MainOptions,
    RunCommandOptions,
    RunResult
} from "../types.js";
import {
    formatRuntimeError,
    formatUnknownFlag,
    formatUnknownSubcommand,
    formatValidationErrors
} from "../validator/error-formatter.js";
import { validateArgs } from "../validator/zod-validator.js";

/**
 * Internal options for runCommand (includes context tracking)
 */
interface InternalCommandOptions extends InternalRunOptions {
  /** Command hierarchy context (internal use) */
  _context?: CommandContext;
  /** Existing logs to include (for subcommand routing) */
  _existingLogs?: CollectedLogs;
}

/**
 * Run a command with the given arguments (programmatic/test usage)
 *
 * This function parses arguments, validates them, routes to subcommands,
 * and executes the command. It does NOT call process.exit.
 *
 * @param command - The command to run
 * @param argv - Command line arguments to parse
 * @param options - Run options
 * @returns The result of command execution
 *
 * @example
 * ```ts
 * import { defineCommand, runCommand } from "politty";
 *
 * const command = defineCommand({
 *   name: "my-cli",
 *   args: z.object({ name: z.string() }),
 *   run: ({ name }) => console.log(`Hello, ${name}!`),
 * });
 *
 * // In tests
 * const result = await runCommand(command, ["--name", "World"]);
 * expect(result.exitCode).toBe(0);
 * ```
 */
export async function runCommand<TResult = unknown>(
  command: AnyCommand,
  argv: string[],
  options: RunCommandOptions = {},
): Promise<RunResult<TResult>> {
  return runCommandInternal(command, argv, {
    ...options,
    handleSignals: false,
    skipValidation: options.skipValidation,
  });
}

/**
 * Run a CLI command as the main entry point
 *
 * This function:
 * - Uses process.argv for arguments
 * - Handles SIGINT/SIGTERM signals
 * - Calls process.exit with the appropriate exit code
 *
 * @param command - The command to run
 * @param options - Main options (version, debug)
 *
 * @example
 * ```ts
 * import { defineCommand, runMain } from "politty";
 *
 * const command = defineCommand({
 *   name: "my-cli",
 *   run: () => console.log("Hello!"),
 * });
 *
 * runMain(command, { version: "1.0.0" });
 * ```
 */
export async function runMain(command: AnyCommand, options: MainOptions = {}): Promise<never> {
  const result = await runCommandInternal(command, process.argv.slice(2), {
    debug: options.debug,
    captureErrorLogs: options.captureErrorLogs,
    skipValidation: options.skipValidation,
    handleSignals: true,
    _context: {
      commandPath: [],
      rootName: command.name,
      rootVersion: options.version,
    },
  });

  process.exit(result.exitCode);
}

/**
 * Internal implementation of command running
 */
async function runCommandInternal<TResult = unknown>(
  command: AnyCommand,
  argv: string[],
  options: InternalCommandOptions = {},
): Promise<RunResult<TResult>> {
  // Initialize or get existing context
  const context: CommandContext = options._context ?? {
    commandPath: [],
    rootName: command.name,
  };

  // Start log collection if enabled
  const shouldCaptureLogs = options.captureErrorLogs ?? false;
  const collector = shouldCaptureLogs ? createLogCollector() : null;
  collector?.start();

  // Helper to get current logs merged with existing
  const getCurrentLogs = (): CollectedLogs => {
    const existingLogs = options._existingLogs ?? emptyLogs();
    const collectedLogs = collector?.getLogs() ?? emptyLogs();
    return {
      errors: [...existingLogs.errors, ...collectedLogs.errors],
      warnings: [...existingLogs.warnings, ...collectedLogs.warnings],
    };
  };

  try {
    // Parse arguments
    const parseResult = parseArgs(argv, command, { skipValidation: options.skipValidation });

    // Handle --help or --help-all
    if (parseResult.helpRequested || parseResult.helpAllRequested) {
      // Check if there's an unknown subcommand specified
      let hasUnknownSubcommand = false;
      const subCmdNames = listSubCommands(command);
      if (subCmdNames.length > 0) {
        // Find first positional argument (potential subcommand)
        const potentialSubCmd = argv.find((arg) => !arg.startsWith("-"));
        if (potentialSubCmd && !subCmdNames.includes(potentialSubCmd)) {
          console.error(formatUnknownSubcommand(potentialSubCmd, subCmdNames));
          console.error("");
          hasUnknownSubcommand = true;
        }
      }

      const help = generateHelp(command, {
        showSubcommands: options.showSubcommands ?? true,
        showSubcommandOptions: parseResult.helpAllRequested || options.showSubcommandOptions,
        context,
      });
      console.log(help);
      collector?.stop();
      if (hasUnknownSubcommand) {
        return {
          success: false,
          error: new Error(`Unknown subcommand: ${argv.find((arg) => !arg.startsWith("-"))}`),
          exitCode: 1,
          logs: getCurrentLogs(),
        };
      }
      return { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() };
    }

    // Handle --version
    if (parseResult.versionRequested) {
      // For subcommands, show root version
      const version = context.rootVersion;
      if (version) {
        console.log(version);
      }
      collector?.stop();
      return { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() };
    }

    // Handle subcommand
    if (parseResult.subCommand) {
      const subCmd = await resolveSubcommand(command, parseResult.subCommand);
      if (subCmd) {
        // Build new context for subcommand
        const subContext: CommandContext = {
          commandPath: [...(context.commandPath ?? []), parseResult.subCommand],
          rootName: context.rootName,
          rootVersion: context.rootVersion,
        };
        // Stop this collector and pass logs to subcommand
        collector?.stop();
        return runCommandInternal<TResult>(subCmd, parseResult.remainingArgs, {
          ...options,
          _context: subContext,
          _existingLogs: getCurrentLogs(),
        });
      }
    }

    // If command has subcommands but none specified, show help
    const subCmds = listSubCommands(command);
    if (subCmds.length > 0 && !parseResult.subCommand && !command.run) {
      const help = generateHelp(command, {
        showSubcommands: options.showSubcommands ?? true,
        context,
      });
      console.log(help);
      collector?.stop();
      return { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() };
    }

    // Warn about unknown flags
    if (parseResult.unknownFlags.length > 0) {
      const knownFlags = parseResult.extractedFields?.fields.map((f) => f.name) ?? [];
      for (const flag of parseResult.unknownFlags) {
        console.error(formatUnknownFlag(flag, knownFlags));
      }
      collector?.stop();
      return {
        success: false,
        error: new Error(`Unknown flags: ${parseResult.unknownFlags.join(", ")}`),
        exitCode: 1,
        logs: getCurrentLogs(),
      };
    }

    // Validate arguments
    if (!command.argsSchema) {
      // No schema, run with empty args
      // Stop this collector and pass logs to executeLifecycle
      collector?.stop();
      const result = await executeLifecycle(command, {} as Record<string, never>, {
        handleSignals: options.handleSignals,
        captureErrorLogs: options.captureErrorLogs,
        existingLogs: getCurrentLogs(),
      });
      return result as RunResult<TResult>;
    }

    const validationResult = validateArgs(parseResult.rawArgs, command.argsSchema);

    if (!validationResult.success) {
      console.error(formatValidationErrors(validationResult.errors));
      collector?.stop();
      return {
        success: false,
        error: new Error(formatValidationErrors(validationResult.errors)),
        exitCode: 1,
        logs: getCurrentLogs(),
      };
    }

    // Run the command
    // Stop this collector and pass logs to executeLifecycle
    collector?.stop();
    const result = await executeLifecycle(command, validationResult.data, {
      handleSignals: options.handleSignals,
      captureErrorLogs: options.captureErrorLogs,
      existingLogs: getCurrentLogs(),
    });

    return result as RunResult<TResult>;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(formatRuntimeError(err, options.debug ?? false));
    collector?.stop();
    return {
      success: false,
      error: err,
      exitCode: 1,
      logs: getCurrentLogs(),
    };
  }
}
