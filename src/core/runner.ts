import { executeLifecycle } from "../executor/command-runner.js";
import { createLogCollector, emptyLogs, mergeLogs } from "../executor/log-collector.js";
import { listSubCommands, resolveSubcommand } from "../executor/subcommand-router.js";
import { generateHelp, type CommandContext } from "../output/help-generator.js";
import { parseArgs } from "../parser/arg-parser.js";
import { findFirstPositional } from "../parser/subcommand-scanner.js";
import type {
  AnyCommand,
  ArgsSchema,
  CollectedLogs,
  GlobalCleanupContext,
  InternalRunOptions,
  Logger,
  MainOptions,
  RunCommandOptions,
  RunResult,
} from "../types.js";
import {
  validateCaseVariantCollisions,
  validateDuplicateAliases,
  validateDuplicateFields,
  validateReservedAliases,
} from "../validator/command-validator.js";
import {
  findSimilar,
  formatRuntimeError,
  formatUnknownFlagWarning,
} from "../validator/error-formatter.js";
import {
  formatValidationErrors as formatPlainValidationErrors,
  validateArgs,
} from "../validator/zod-validator.js";
import { createDualCaseProxy } from "./case-proxy.js";
import { runEffects } from "./effect-runner.js";
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
  /** Global cleanup hook for signal handling */
  _globalCleanup?: ((context: GlobalCleanupContext) => void | Promise<void>) | undefined;
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
  const globalExtracted = extractAndValidateGlobal(options);

  // Start log collection for global setup/cleanup if enabled
  const shouldCaptureLogs = options.captureLogs ?? false;
  const globalCollector = shouldCaptureLogs ? createLogCollector() : null;

  // Global setup
  if (options.setup) {
    globalCollector?.start();
    try {
      await options.setup({});
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (options.cleanup) {
        try {
          await options.cleanup({ error });
        } catch {
          // Swallow cleanup error when setup already failed
        }
      }
      globalCollector?.stop();
      const logs = globalCollector?.getLogs() ?? emptyLogs();
      return { success: false, error, exitCode: 1, logs };
    }
    globalCollector?.stop();
  }

  const result = await runCommandInternal<TResult>(command, argv, {
    ...options,
    handleSignals: false,
    _globalExtracted: globalExtracted,
    _globalCleanup: options.cleanup,
    _existingLogs: globalCollector?.getLogs(),
  });

  // Global cleanup (always)
  if (options.cleanup) {
    const cleanupCollector = shouldCaptureLogs ? createLogCollector() : null;
    cleanupCollector?.start();
    const cleanupCtx: GlobalCleanupContext = {
      error: !result.success ? result.error : undefined,
    };
    try {
      await options.cleanup(cleanupCtx);
    } catch (e) {
      if (result.success) {
        const error = e instanceof Error ? e : new Error(String(e));
        cleanupCollector?.stop();
        const logs = mergeLogs(result.logs, cleanupCollector?.getLogs() ?? emptyLogs());
        return { success: false, error, exitCode: 1, logs };
      }
    }
    cleanupCollector?.stop();
    const cleanupLogs = cleanupCollector?.getLogs() ?? emptyLogs();
    if (cleanupLogs.entries.length > 0) {
      return { ...result, logs: mergeLogs(result.logs, cleanupLogs) } as RunResult<TResult>;
    }
  }

  return result;
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
  const globalExtracted = extractAndValidateGlobal(options);

  // Global setup
  if (options.setup) {
    try {
      await options.setup({});
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (options.cleanup) {
        try {
          await options.cleanup({ error });
        } catch {
          // Swallow cleanup error when setup already failed
        }
      }
      process.exit(1);
    }
  }

  const result = await runCommandInternal(command, process.argv.slice(2), {
    debug: options.debug,
    captureLogs: options.captureLogs,
    skipValidation: options.skipValidation,
    handleSignals: true,
    logger: options.logger,
    globalArgs: options.globalArgs,
    resolvePrompts: options.resolvePrompts,
    _globalExtracted: globalExtracted,
    _globalCleanup: options.cleanup,
    _context: {
      commandPath: [],
      rootName: command.name,
      rootVersion: options.version,
      globalExtracted,
    },
  });

  // Display errors (controlled by displayErrors option, default: true)
  if ((options.displayErrors ?? true) && !result.success && result.error) {
    const errorLogger = options.logger ?? defaultLogger;
    errorLogger.error(formatRuntimeError(result.error, options.debug ?? false));
  }

  // Global cleanup (always)
  if (options.cleanup) {
    const cleanupCtx: GlobalCleanupContext = {
      error: !result.success ? result.error : undefined,
    };
    try {
      await options.cleanup(cleanupCtx);
    } catch {
      // Swallow - we're about to exit anyway
    }
  }

  // Flush stdout/stderr before exit to prevent truncated output when piped.
  // When stdout/stderr is a pipe, writes are buffered asynchronously.
  // Calling process.exit() before the buffer is drained causes data loss.
  if (process.stdout.writableLength > 0) {
    await new Promise<void>((resolve) => process.stdout.once("drain", resolve));
  }
  if (process.stderr.writableLength > 0) {
    await new Promise<void>((resolve) => process.stderr.once("drain", resolve));
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
        const unknownCmd = findFirstPositional(argv, context.globalExtracted) ?? "";
        const similar = findSimilar(unknownCmd, subCmdNames);
        const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(", ")}?` : "";
        return {
          success: false,
          error: new Error(
            `Unknown subcommand: ${unknownCmd}${suggestion ? `.${suggestion}` : ""}`,
          ),
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
    if (options.globalArgs && options._globalExtracted) {
      // Apply env fallbacks for global args
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

      // Prompt for missing global args (if resolvePrompts callback is provided)
      if (options.resolvePrompts) {
        const resolved = await options.resolvePrompts(
          accumulatedGlobalArgs,
          options._globalExtracted,
        );
        Object.assign(accumulatedGlobalArgs, resolved);
      }

      // Note: validation only sees recognized global flags. Misspelled globals
      // (e.g., --verboes) are treated as local flags by the scanner, so a strict
      // global schema cannot catch them. They are rejected only if the local
      // command schema is also strict.
      const globalValidation = validateArgs(accumulatedGlobalArgs, options.globalArgs);
      if (!globalValidation.success) {
        collector?.stop();
        return {
          success: false,
          error: new Error(formatPlainValidationErrors(globalValidation.errors)),
          exitCode: 1,
          logs: getCurrentLogs(),
        };
      }
      validatedGlobalArgs = globalValidation.data as Record<string, unknown>;
    }

    // Validate arguments
    if (!command.args) {
      // No schema, run with global args (or empty args)
      const proxiedGlobalArgs = createDualCaseProxy(validatedGlobalArgs);
      // Run effects for global args (after all validations succeed)
      if (options._globalExtracted) {
        await runEffects(proxiedGlobalArgs, options._globalExtracted, proxiedGlobalArgs);
      }
      collector?.stop();
      const mergedArgs = proxiedGlobalArgs as Record<string, never>;
      const result = await executeLifecycle(command, mergedArgs, {
        handleSignals: options.handleSignals,
        captureLogs: options.captureLogs,
        existingLogs: getCurrentLogs(),
        globalCleanup: options._globalCleanup,
      });
      return result as RunResult<TResult>;
    }

    // Prompt for missing command args (if resolvePrompts callback is provided)
    let argsToValidate = parseResult.rawArgs;
    if (options.resolvePrompts && parseResult.extractedFields) {
      const resolved = await options.resolvePrompts(argsToValidate, parseResult.extractedFields);
      argsToValidate = { ...argsToValidate, ...resolved };
    }

    const validationResult = validateArgs(argsToValidate, command.args);

    if (!validationResult.success) {
      collector?.stop();
      return {
        success: false,
        error: new Error(formatPlainValidationErrors(validationResult.errors)),
        exitCode: 1,
        logs: getCurrentLogs(),
      };
    }

    // Wrap validated args with dual-case proxy before effects and execution
    const proxiedCommandArgs = createDualCaseProxy(
      validationResult.data as Record<string, unknown>,
    );
    const proxiedGlobalArgs = createDualCaseProxy(validatedGlobalArgs);

    // Run effects after all validations succeed (global effects first, then command effects)
    if (options._globalExtracted) {
      await runEffects(proxiedGlobalArgs, options._globalExtracted, proxiedGlobalArgs);
    }
    if (parseResult.extractedFields) {
      await runEffects(proxiedCommandArgs, parseResult.extractedFields, proxiedGlobalArgs);
    }

    // Merge global args with command args (command args take precedence on collision)
    const mergedArgs = createDualCaseProxy({ ...proxiedGlobalArgs, ...proxiedCommandArgs });

    // Run the command
    // Stop this collector and pass logs to executeLifecycle
    collector?.stop();
    const result = await executeLifecycle(command, mergedArgs, {
      handleSignals: options.handleSignals,
      captureLogs: options.captureLogs,
      existingLogs: getCurrentLogs(),
      globalCleanup: options._globalCleanup,
    });

    return result as RunResult<TResult>;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
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
 * Extract global fields from options.globalArgs and validate the schema upfront.
 * Rejects positional fields since global options must be flags.
 * Returns undefined when no globalArgs is provided.
 */
function extractAndValidateGlobal(options: {
  globalArgs?: ArgsSchema;
  skipValidation?: boolean;
}): ExtractedFields | undefined {
  if (!options.globalArgs) return undefined;
  const extracted = extractFields(options.globalArgs);
  if (!options.skipValidation) {
    validateDuplicateFields(extracted);
    validateCaseVariantCollisions(extracted);
    validateDuplicateAliases(extracted);
    validateReservedAliases(extracted, true);
    const positionalNames = extracted.fields.filter((f) => f.positional).map((f) => f.name);
    if (positionalNames.length > 0) {
      throw new Error(
        `Global options schema must not contain positional arguments. Found: ${positionalNames.join(", ")}`,
      );
    }
  }
  return extracted;
}
