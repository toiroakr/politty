import { executeLifecycle } from "../executor/command-runner.js";
import { createLogCollector, emptyLogs, mergeLogs } from "../executor/log-collector.js";
import { listSubCommands, resolveSubcommand } from "../executor/subcommand-router.js";
import { generateHelp, type CommandContext } from "../output/help-generator.js";
import { parseArgs } from "../parser/arg-parser.js";
import { buildParserOptions } from "../parser/argv-parser.js";
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
  validateDuplicateAliases,
  validateDuplicateFields,
} from "../validator/command-validator.js";
import {
  formatRuntimeError,
  formatUnknownFlag,
  formatUnknownFlagWarning,
  formatUnknownSubcommand,
  formatValidationErrors,
} from "../validator/error-formatter.js";
import { validateArgs } from "../validator/zod-validator.js";
import { extractFields, type ExtractedFields } from "./schema-extractor.js";

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
  _context?: CommandContext | undefined;
  /** Existing logs to include (for subcommand routing) */
  _existingLogs?: CollectedLogs | undefined;
  /** Extracted fields from global args schema */
  _globalExtracted?: ExtractedFields | undefined;
  /** Already parsed global args (accumulated from parent levels) */
  _parsedGlobalArgs?: Record<string, unknown> | undefined;
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
  // Extract global fields once if globalArgs is provided
  const globalExtracted = options.globalArgs ? extractFields(options.globalArgs) : undefined;
  if (globalExtracted && !options.skipValidation) {
    validateGlobalSchema(globalExtracted);
  }

  return runCommandInternal(command, argv, {
    ...options,
    handleSignals: false,
    skipValidation: options.skipValidation,
    logger: options.logger,
    globalArgs: options.globalArgs,
    _globalExtracted: globalExtracted,
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
  // Extract global fields once if globalArgs is provided
  const globalExtracted = options.globalArgs ? extractFields(options.globalArgs) : undefined;
  if (globalExtracted && !options.skipValidation) {
    validateGlobalSchema(globalExtracted);
  }

  const result = await runCommandInternal(command, process.argv.slice(2), {
    debug: options.debug,
    captureLogs: options.captureLogs,
    skipValidation: options.skipValidation,
    handleSignals: true,
    logger: options.logger,
    globalArgs: options.globalArgs,
    _globalExtracted: globalExtracted,
    _context: {
      commandPath: [],
      rootName: command.name,
      rootVersion: options.version,
      globalExtracted,
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
    globalExtracted: options._globalExtracted,
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
    // Parse arguments
    const parseResult = parseArgs(argv, command, {
      skipValidation: options.skipValidation,
      globalExtracted: options._globalExtracted,
    });

    // Accumulate global args from this parse level.
    // Note: uses shallow spread, so array-valued globals split across a subcommand
    // boundary (e.g., `cli --tag a sub --tag b`) will only keep the later value.
    const accumulatedGlobalArgs = {
      ...options._parsedGlobalArgs,
      ...parseResult.rawGlobalArgs,
    };

    // Handle --help or --help-all
    if (parseResult.helpRequested || parseResult.helpAllRequested) {
      // Check if there's an unknown subcommand specified
      let hasUnknownSubcommand = false;
      const subCmdNames = listSubCommands(command);
      if (subCmdNames.length > 0) {
        // Find first positional argument (potential subcommand), skipping global option values
        const potentialSubCmd = findFirstPositional(argv, context.globalExtracted);
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
          globalExtracted: context.globalExtracted,
        };
        // Stop this collector and pass logs to subcommand
        collector?.stop();
        return runCommandInternal<TResult>(subCmd, parseResult.remainingArgs, {
          ...options,
          _context: subContext,
          _existingLogs: getCurrentLogs(),
          _parsedGlobalArgs: accumulatedGlobalArgs,
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

    // Validate global args at the leaf command level
    let validatedGlobalArgs: Record<string, unknown> = {};
    if (options.globalArgs && Object.keys(accumulatedGlobalArgs).length > 0) {
      // Apply env fallbacks for global args
      if (options._globalExtracted) {
        for (const field of options._globalExtracted.fields) {
          if (field.env && accumulatedGlobalArgs[field.name] === undefined) {
            const envNames = Array.isArray(field.env) ? field.env : [field.env];
            for (const envName of envNames) {
              const envValue = process.env[envName];
              if (envValue !== undefined) {
                accumulatedGlobalArgs[field.name] = envValue;
                break;
              }
            }
          }
        }
      }

      const globalValidation = validateArgs(accumulatedGlobalArgs, options.globalArgs);
      if (!globalValidation.success) {
        logger.error(formatValidationErrors(globalValidation.errors));
        collector?.stop();
        return {
          success: false,
          error: new Error(formatValidationErrors(globalValidation.errors)),
          exitCode: 1,
          logs: getCurrentLogs(),
        };
      }
      validatedGlobalArgs = globalValidation.data as Record<string, unknown>;
    } else if (options.globalArgs) {
      // No global args provided, validate with empty object for defaults
      const globalValidation = validateArgs({}, options.globalArgs);
      if (!globalValidation.success) {
        logger.error(formatValidationErrors(globalValidation.errors));
        collector?.stop();
        return {
          success: false,
          error: new Error(formatValidationErrors(globalValidation.errors)),
          exitCode: 1,
          logs: getCurrentLogs(),
        };
      }
      validatedGlobalArgs = globalValidation.data as Record<string, unknown>;
    }

    // Validate arguments
    if (!command.args) {
      // No schema, run with global args (or empty args)
      collector?.stop();
      const mergedArgs = { ...validatedGlobalArgs } as Record<string, never>;
      const result = await executeLifecycle(command, mergedArgs, {
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

    // Merge global args with command args (command args take precedence on collision)
    const mergedArgs = { ...validatedGlobalArgs, ...validationResult.data };

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

/**
 * Validate global args schema upfront (mirrors the per-command validation in parseArgs).
 * Rejects positional fields since global options must be flags.
 */
function validateGlobalSchema(globalExtracted: ExtractedFields): void {
  validateDuplicateFields(globalExtracted);
  validateDuplicateAliases(globalExtracted);
  const positionals = globalExtracted.fields.filter((f) => f.positional);
  if (positionals.length > 0) {
    throw new Error(
      `Global options schema must not contain positional arguments. Found: ${positionals.map((p) => p.name).join(", ")}`,
    );
  }
}

/**
 * Find the first positional argument in argv, properly skipping global flag values.
 * Without globalExtracted, falls back to the first non-flag token.
 */
function findFirstPositional(
  argv: string[],
  globalExtracted?: ExtractedFields,
): string | undefined {
  if (!globalExtracted) {
    return argv.find((arg) => !arg.startsWith("-"));
  }

  const { booleanFlags = new Set(), aliasMap = new Map() } = buildParserOptions(globalExtracted);
  const cliNames = new Set(globalExtracted.fields.map((f) => f.cliName));
  const aliases = new Set(globalExtracted.fields.filter((f) => f.alias).map((f) => f.alias!));

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (!arg.startsWith("-")) return arg;
    if (arg === "--") return undefined;

    // Check if this is a known global flag that takes a value
    let resolvedName: string | undefined;
    if (arg.startsWith("--") && !arg.includes("=")) {
      const name = arg.slice(2);
      const baseName = name.startsWith("no-") ? name.slice(3) : name;
      if (cliNames.has(name) || cliNames.has(baseName)) {
        resolvedName = aliasMap.get(baseName) ?? baseName;
      }
    } else if (arg.startsWith("-") && arg.length === 2) {
      const ch = arg[1]!;
      if (aliases.has(ch)) {
        resolvedName = aliasMap.get(ch) ?? ch;
      }
    }

    // Skip next token if this is a non-boolean global flag without = value
    if (resolvedName && !booleanFlags.has(resolvedName) && !arg.slice(2).startsWith("no-")) {
      i++;
    }
  }
  return undefined;
}
