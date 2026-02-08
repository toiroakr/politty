import { executeLifecycle } from "../executor/command-runner.js";
import { createLogCollector, emptyLogs, mergeLogs } from "../executor/log-collector.js";
import { listSubCommands, resolveSubcommand } from "../executor/subcommand-router.js";
import { generateHelp, type CommandContext } from "../output/help-generator.js";
import { parseArgs } from "../parser/arg-parser.js";
import type {
  AnyCommand,
  CollectedLogs,
  InternalRunOptions,
  Logger,
  MainOptions,
  RunCommandOptions,
  RunResult,
} from "../types.js";
import {
  formatRuntimeError,
  formatUnknownFlag,
  formatUnknownFlagWarning,
  formatUnknownSubcommand,
  formatValidationErrors,
} from "../validator/error-formatter.js";
import { validateArgs } from "../validator/zod-validator.js";

/**
 * Default logger using console
 */
const defaultLogger: Logger = {
  log: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
};

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
    logger: options.logger,
    _globalArgsContext: options.globalArgs ? { schema: options.globalArgs } : undefined,
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
    captureLogs: options.captureLogs,
    skipValidation: options.skipValidation,
    handleSignals: true,
    logger: options.logger,
    _context: {
      commandPath: [],
      rootName: command.name,
      rootVersion: options.version,
    },
    _globalArgsContext: options.globalArgs ? { schema: options.globalArgs } : undefined,
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
  // Get logger (use default if not provided)
  const logger = options.logger ?? defaultLogger;

  // Initialize or get existing context
  const context: CommandContext = options._context ?? {
    commandPath: [],
    rootName: command.name,
  };

  // Start log collection if enabled
  const shouldCaptureLogs = options.captureLogs ?? false;
  const collector = shouldCaptureLogs ? createLogCollector() : null;
  collector?.start();

  // Helper to get current logs merged with existing
  const getCurrentLogs = (): CollectedLogs => {
    const existingLogs = options._existingLogs ?? emptyLogs();
    const collectedLogs = collector?.getLogs() ?? emptyLogs();
    return mergeLogs(existingLogs, collectedLogs);
  };

  try {
    // Get global args context
    const globalArgsContext = options._globalArgsContext;
    const globalArgsSchema = globalArgsContext?.schema;

    // Parse arguments (include global args schema for proper parsing)
    const parseResult = parseArgs(argv, command, {
      skipValidation: options.skipValidation,
      globalArgsSchema,
    });

    // Handle --help or --help-all
    if (parseResult.helpRequested || parseResult.helpAllRequested) {
      // Check if there's an unknown subcommand specified
      let hasUnknownSubcommand = false;
      const subCmdNames = listSubCommands(command);
      if (subCmdNames.length > 0) {
        // Find first positional argument (potential subcommand)
        const potentialSubCmd = argv.find((arg) => !arg.startsWith("-"));
        if (potentialSubCmd && !subCmdNames.includes(potentialSubCmd)) {
          logger.error(formatUnknownSubcommand(potentialSubCmd, subCmdNames));
          logger.error("");
          hasUnknownSubcommand = true;
        }
      }

      const help = generateHelp(command, {
        showSubcommands: options.showSubcommands ?? true,
        showSubcommandOptions: parseResult.helpAllRequested || options.showSubcommandOptions,
        context,
        globalArgsSchema,
      });
      logger.log(help);
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
        logger.log(version);
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

        // Parse and propagate global args to subcommand
        let updatedGlobalArgsContext = globalArgsContext;
        if (globalArgsContext && !globalArgsContext.values) {
          // First time: parse global args and store values
          const globalValidation = validateArgs(
            parseResult.globalRawArgs ?? {},
            globalArgsContext.schema,
          );
          if (globalValidation.success) {
            updatedGlobalArgsContext = {
              schema: globalArgsContext.schema,
              values: globalValidation.data as Record<string, unknown>,
            };
          }
        }

        // Stop this collector and pass logs to subcommand
        collector?.stop();
        return runCommandInternal<TResult>(subCmd, parseResult.remainingArgs, {
          ...options,
          _context: subContext,
          _existingLogs: getCurrentLogs(),
          _globalArgsContext: updatedGlobalArgsContext,
        });
      }
    }

    // If command has subcommands but none specified, show help
    const subCmds = listSubCommands(command);
    if (subCmds.length > 0 && !parseResult.subCommand && !command.run) {
      const help = generateHelp(command, {
        showSubcommands: options.showSubcommands ?? true,
        context,
        globalArgsSchema,
      });
      logger.log(help);
      collector?.stop();
      return { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() };
    }

    // Handle unknown flags based on schema's unknownKeysMode
    if (parseResult.unknownFlags.length > 0) {
      const unknownKeysMode = parseResult.extractedFields?.unknownKeysMode ?? "strip";
      const knownFlags = parseResult.extractedFields?.fields.map((f) => f.name) ?? [];

      if (unknownKeysMode === "strict") {
        // strict mode: treat unknown flags as errors
        for (const flag of parseResult.unknownFlags) {
          logger.error(formatUnknownFlag(flag, knownFlags));
        }
        collector?.stop();
        return {
          success: false,
          error: new Error(`Unknown flags: ${parseResult.unknownFlags.join(", ")}`),
          exitCode: 1,
          logs: getCurrentLogs(),
        };
      } else if (unknownKeysMode === "strip") {
        // strip mode (default): warn about unknown flags but continue
        for (const flag of parseResult.unknownFlags) {
          logger.error(formatUnknownFlagWarning(flag, knownFlags));
        }
        // Continue execution - don't return error
      }
      // passthrough mode: silently ignore unknown flags
    }

    // Get global args values (either from context or parse now)
    let globalArgsValues: Record<string, unknown> = {};
    if (globalArgsContext) {
      if (globalArgsContext.values) {
        // Start with cached values from parent command
        globalArgsValues = { ...globalArgsContext.values };
      }

      // Merge any newly parsed global args from this command's argv
      // This handles the case where global flags appear after the subcommand:
      // e.g., `cli build --verbose` where --verbose is a global option
      if (parseResult.globalRawArgs && Object.keys(parseResult.globalRawArgs).length > 0) {
        const globalValidation = validateArgs(parseResult.globalRawArgs, globalArgsContext.schema);
        if (globalValidation.success) {
          // Newly parsed global args take precedence over cached values
          globalArgsValues = { ...globalArgsValues, ...globalValidation.data };
        }
      } else if (!globalArgsContext.values) {
        // No cached values and no new global args: apply defaults
        const globalValidation = validateArgs({}, globalArgsContext.schema);
        if (globalValidation.success) {
          globalArgsValues = globalValidation.data as Record<string, unknown>;
        }
      }
    }

    // Validate arguments
    if (!command.args) {
      // No schema, run with global args only
      // Stop this collector and pass logs to executeLifecycle
      collector?.stop();
      const result = await executeLifecycle(command, globalArgsValues, {
        handleSignals: options.handleSignals,
        captureLogs: options.captureLogs,
        existingLogs: getCurrentLogs(),
      });
      return result as RunResult<TResult>;
    }

    const validationResult = validateArgs(parseResult.rawArgs, command.args);

    if (!validationResult.success) {
      logger.error(formatValidationErrors(validationResult.errors));
      collector?.stop();
      return {
        success: false,
        error: new Error(formatValidationErrors(validationResult.errors)),
        exitCode: 1,
        logs: getCurrentLogs(),
      };
    }

    // Merge global args with command args (command args take precedence)
    const mergedArgs = { ...globalArgsValues, ...validationResult.data };

    // Run the command
    // Stop this collector and pass logs to executeLifecycle
    collector?.stop();
    const result = await executeLifecycle(command, mergedArgs, {
      handleSignals: options.handleSignals,
      captureLogs: options.captureLogs,
      existingLogs: getCurrentLogs(),
    });

    return result as RunResult<TResult>;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error(formatRuntimeError(err, options.debug ?? false));
    collector?.stop();
    return {
      success: false,
      error: err,
      exitCode: 1,
      logs: getCurrentLogs(),
    };
  }
}
