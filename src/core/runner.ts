import { extractFieldsCached, type ExtractedFields } from "../core/schema-extractor.js";
import { executeLifecycle } from "../executor/command-runner.js";
import { createLogCollector, emptyLogs, mergeLogs } from "../executor/log-collector.js";
import { listSubCommands, resolveSubcommand } from "../executor/subcommand-router.js";
import { generateHelp, type CommandContext } from "../output/help-generator.js";
import { parseArgs } from "../parser/arg-parser.js";
import type {
  AnyCommand,
  CollectedLogs,
  GlobalArgsContext,
  InternalRunOptions,
  Logger,
  MainOptions,
  RunCommandOptions,
  RunResult,
} from "../types.js";
import {
  validateDuplicateAliases,
  validateDuplicateFields,
  validatePositionalConfig,
  validateReservedAliases,
} from "../validator/command-validator.js";
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
  /** Runtime global args context */
  _globalArgsContext?: GlobalArgsContext;
}

const BUILTIN_HELP_FLAGS = new Set(["--help", "--help-all", "-h", "-H"]);

function createGlobalArgsContext(options: InternalCommandOptions): GlobalArgsContext | undefined {
  if (options._globalArgsContext) {
    return options._globalArgsContext;
  }

  if (!options.globalArgs) {
    return undefined;
  }

  const extractedFields = extractFieldsCached(options.globalArgs);
  if (!options.skipValidation) {
    validateDuplicateFields(extractedFields);
    validateDuplicateAliases(extractedFields);
    validatePositionalConfig(extractedFields);
    validateReservedAliases(extractedFields, false);
  }

  return {
    schema: options.globalArgs,
    extractedFields,
  };
}

function validateAndMergeGlobalArgs(
  globalArgsContext: GlobalArgsContext | undefined,
  rawGlobalArgs: Record<string, unknown>,
): { context: GlobalArgsContext | undefined; errorMessage?: string } {
  if (!globalArgsContext) {
    return { context: undefined };
  }

  const hasRawGlobalArgs = Object.keys(rawGlobalArgs).length > 0;
  if (!hasRawGlobalArgs && globalArgsContext.values !== undefined) {
    return { context: globalArgsContext };
  }

  const mergedRawGlobalArgs = {
    ...globalArgsContext.values,
    ...rawGlobalArgs,
  };

  const globalValidationResult = validateArgs(mergedRawGlobalArgs, globalArgsContext.schema);
  if (!globalValidationResult.success) {
    return {
      context: globalArgsContext,
      errorMessage: formatValidationErrors(globalValidationResult.errors),
    };
  }

  return {
    context: {
      ...globalArgsContext,
      values: globalValidationResult.data as Record<string, unknown>,
    },
  };
}

function shouldConsumeNextValue(nextToken: string | undefined): boolean {
  return nextToken !== undefined && !nextToken.startsWith("-");
}

function buildLongFlagMap(
  globalExtracted: ExtractedFields | undefined,
  commandExtracted: ExtractedFields | undefined,
): Map<string, { boolean: boolean }> {
  const map = new Map<string, { boolean: boolean }>();

  // Set global first, then command to preserve command precedence.
  for (const extracted of [globalExtracted, commandExtracted]) {
    if (!extracted) continue;
    for (const field of extracted.fields) {
      const info = { boolean: field.type === "boolean" };
      map.set(field.name, info);
      map.set(field.cliName, info);
    }
  }

  return map;
}

function buildShortFlagMap(
  globalExtracted: ExtractedFields | undefined,
  commandExtracted: ExtractedFields | undefined,
): Map<string, { boolean: boolean }> {
  const map = new Map<string, { boolean: boolean }>();

  // Set global first, then command to preserve command precedence.
  for (const extracted of [globalExtracted, commandExtracted]) {
    if (!extracted) continue;
    for (const field of extracted.fields) {
      if (!field.alias) continue;
      map.set(field.alias, { boolean: field.type === "boolean" });
    }
  }

  return map;
}

function findPotentialSubcommandOnHelp(
  argv: string[],
  globalExtracted: ExtractedFields | undefined,
  commandExtracted: ExtractedFields | undefined,
): string | undefined {
  const longFlags = buildLongFlagMap(globalExtracted, commandExtracted);
  const shortFlags = buildShortFlagMap(globalExtracted, commandExtracted);

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (!token) continue;

    if (token === "--" || BUILTIN_HELP_FLAGS.has(token)) {
      return undefined;
    }

    if (token.startsWith("--")) {
      const withoutDashes = token.slice(2);

      if (withoutDashes.startsWith("no-")) {
        continue;
      }

      const eqIndex = withoutDashes.indexOf("=");
      if (eqIndex !== -1) {
        continue;
      }

      const info = longFlags.get(withoutDashes);
      if (!info || !info.boolean) {
        const nextToken = argv[i + 1];
        if (shouldConsumeNextValue(nextToken)) {
          i++;
        }
      }
      continue;
    }

    if (token.startsWith("-") && token.length > 1) {
      const withoutDash = token.slice(1);
      const eqIndex = withoutDash.indexOf("=");

      if (eqIndex !== -1) {
        continue;
      }

      if (withoutDash.length === 1) {
        const info = shortFlags.get(withoutDash);
        if (!info || !info.boolean) {
          const nextToken = argv[i + 1];
          if (shouldConsumeNextValue(nextToken)) {
            i++;
          }
        }
      }

      continue;
    }

    return token;
  }

  return undefined;
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
    globalArgs: options.globalArgs,
    _context: {
      commandPath: [],
      rootName: command.name,
      rootVersion: options.version,
    },
  });

  // Flush stdout before exit to prevent truncated output when piped.
  // When stdout is a pipe (e.g., eval "$(cli completion zsh)"), writes are
  // buffered asynchronously. Calling process.exit() before the buffer is
  // drained causes data loss.
  if (process.stdout.writableLength > 0) {
    await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
  }

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
    const globalArgsContext = createGlobalArgsContext(options);

    // Parse arguments
    const parseResult = parseArgs(argv, command, {
      skipValidation: options.skipValidation,
      globalArgsContext,
    });

    // Handle --help or --help-all
    if (parseResult.helpRequested || parseResult.helpAllRequested) {
      // Check if there's an unknown subcommand specified
      let hasUnknownSubcommand = false;
      let unknownSubcommand: string | undefined;
      const subCmdNames = listSubCommands(command);
      if (subCmdNames.length > 0) {
        const commandExtracted = command.args ? extractFieldsCached(command.args) : undefined;
        const potentialSubCmd = findPotentialSubcommandOnHelp(
          argv,
          globalArgsContext?.extractedFields,
          commandExtracted,
        );
        if (potentialSubCmd && !subCmdNames.includes(potentialSubCmd)) {
          logger.error(formatUnknownSubcommand(potentialSubCmd, subCmdNames));
          logger.error("");
          hasUnknownSubcommand = true;
          unknownSubcommand = potentialSubCmd;
        }
      }

      const help = generateHelp(command, {
        showSubcommands: options.showSubcommands ?? true,
        showSubcommandOptions: parseResult.helpAllRequested || options.showSubcommandOptions,
        context,
        globalArgs: globalArgsContext?.schema,
      });
      logger.log(help);
      collector?.stop();
      if (hasUnknownSubcommand) {
        return {
          success: false,
          error: new Error(`Unknown subcommand: ${unknownSubcommand}`),
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

    const mergedGlobal = validateAndMergeGlobalArgs(globalArgsContext, parseResult.rawGlobalArgs);
    if (mergedGlobal.errorMessage) {
      logger.error(mergedGlobal.errorMessage);
      collector?.stop();
      return {
        success: false,
        error: new Error(mergedGlobal.errorMessage),
        exitCode: 1,
        logs: getCurrentLogs(),
      };
    }

    // Handle unknown flags based on schema's unknownKeysMode
    if (parseResult.unknownFlags.length > 0) {
      const unknownKeysMode = parseResult.extractedFields?.unknownKeysMode ?? "strip";
      const knownFlags = [
        ...(parseResult.extractedFields?.fields.map((f) => f.name) ?? []),
        ...(mergedGlobal.context?.extractedFields.fields.map((f) => f.name) ?? []),
      ];

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
          ...(mergedGlobal.context ? { _globalArgsContext: mergedGlobal.context } : {}),
        });
      }
    }

    // If command has subcommands but none specified, show help
    const subCmds = listSubCommands(command);
    if (subCmds.length > 0 && !parseResult.subCommand && !command.run) {
      const help = generateHelp(command, {
        showSubcommands: options.showSubcommands ?? true,
        context,
        globalArgs: globalArgsContext?.schema,
      });
      logger.log(help);
      collector?.stop();
      return { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() };
    }

    // Validate arguments
    if (!command.args) {
      const mergedArgs = mergedGlobal.context?.values ?? {};
      // Stop this collector and pass logs to executeLifecycle
      collector?.stop();
      const result = await executeLifecycle(command, mergedArgs, {
        handleSignals: options.handleSignals,
        captureLogs: options.captureLogs,
        existingLogs: getCurrentLogs(),
      });
      return result as RunResult<TResult>;
    }

    const commandValidationResult = validateArgs(parseResult.rawArgs, command.args);

    if (!commandValidationResult.success) {
      logger.error(formatValidationErrors(commandValidationResult.errors));
      collector?.stop();
      return {
        success: false,
        error: new Error(formatValidationErrors(commandValidationResult.errors)),
        exitCode: 1,
        logs: getCurrentLogs(),
      };
    }

    const mergedArgs = {
      ...mergedGlobal.context?.values,
      ...commandValidationResult.data,
    };

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
