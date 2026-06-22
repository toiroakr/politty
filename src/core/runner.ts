import { executeLifecycle } from "../executor/command-runner.js";
import { createLogCollector, emptyLogs, mergeLogs } from "../executor/log-collector.js";
import {
  listSubCommandNamesWithAliases,
  listSubCommands,
  resolveSubcommandWithAlias,
} from "../executor/subcommand-router.js";
import { generateHelp, type CommandContext } from "../output/help-generator.js";
import { parseArgs } from "../parser/arg-parser.js";
import { findFirstPositional, findFirstPositionalIndex } from "../parser/subcommand-scanner.js";
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
  validateDuplicateNegations,
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
 * Hidden internal subcommands (e.g. `__refresh-completion`) are spawned
 * by background hooks and must not run user-provided
 * `setup`/`cleanup`/`prompt` or required `globalArgs`. Those exist for
 * the foreground CLI run; replaying them in a detached child causes
 * duplicate side effects, stuck prompts, and validation failures the
 * user never opted into.
 *
 * We treat any registered subcommand whose name starts with `__` as
 * internal. We use `findFirstPositional` (schema-aware) instead of the
 * naive "first non-flag token" so an option *value* like
 * `--name __refresh-completion` doesn't trip the bypass — that would
 * silently skip lifecycle hooks for ordinary invocations.
 */
function isInternalSubcommandInvocation(
  command: AnyCommand,
  argv: string[],
  globalExtracted?: ExtractedFields,
): boolean {
  const firstPositional = findFirstPositional(argv, globalExtracted);
  if (!firstPositional || !firstPositional.startsWith("__")) return false;
  return Boolean(command.subCommands?.[firstPositional]);
}

/**
 * Run a CLI command as the main entry point
 *
 * This function:
 * - Uses process.argv for arguments
 * - Handles SIGINT/SIGTERM signals
 * - Calls process.exit with the appropriate exit code
 * - Invokes `command.runMainHook` once before parsing if set, so plug-ins
 *   like `withCompletionCommand` can fire detached background work
 * - Bypasses user `setup`/`cleanup`/`prompt` and required `globalArgs`
 *   for registered hidden subcommands whose name starts with `__`
 *   (e.g. `__refresh-completion`)
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
  // Generic hook plug-in point. `withCompletionCommand` uses this to
  // fire a detached background refresh of the on-disk completion cache.
  // Wrapped in try/catch so a misbehaving hook can never break the CLI.
  if (command.runMainHook) {
    try {
      command.runMainHook(process.argv.slice(2));
    } catch {
      // Best-effort: hooks must never block the CLI.
    }
  }

  const argv = process.argv.slice(2);
  // Extract the global schema once *before* the bypass check so
  // `findFirstPositional` can correctly skip option values. We re-use
  // the same `globalExtracted` for the actual run when the call is
  // foreground.
  let globalExtractedForBypass: ExtractedFields | undefined;
  if (options.globalArgs) {
    try {
      globalExtractedForBypass = extractFields(options.globalArgs);
    } catch {
      // If the schema is malformed we'll error later; for the bypass
      // check fall back to the no-schema scan (conservative — option
      // values may be misclassified, but that only over-bypasses the
      // detection, never under-bypasses it for ordinary invocations).
    }
  }
  // For internal subcommands, drop user lifecycle hooks and the
  // globalArgs schema. The internal command implements its own
  // best-effort behavior and should not be subject to user policies.
  // Note: under exactOptionalPropertyTypes we must omit the keys (not
  // assign undefined), since `globalArgs?: ArgsSchema` does not accept
  // `undefined` as a value.
  let effectiveOptions: MainOptions = options;
  if (isInternalSubcommandInvocation(command, argv, globalExtractedForBypass)) {
    const { setup: _s, cleanup: _c, prompt: _p, globalArgs: _g, ...rest } = options;
    effectiveOptions = rest;
  }

  const globalExtracted = extractAndValidateGlobal(effectiveOptions);

  // Plugin dispatch: when the first positional is not a known subcommand and a
  // handler is registered, delegate to it (e.g. exec an external `<cli>-<name>`
  // binary). Runs before global setup/cleanup so plugins are independent of the
  // host CLI's lifecycle, and is skipped for internal (`__*`) invocations.
  if (
    effectiveOptions.onUnknownSubcommand &&
    !isInternalSubcommandInvocation(command, argv, globalExtractedForBypass)
  ) {
    const knownSubCommands = listSubCommandNamesWithAliases(command);
    if (knownSubCommands.size > 0) {
      const positionalIndex = findFirstPositionalIndex(argv, globalExtracted);
      const name = positionalIndex >= 0 ? argv[positionalIndex] : undefined;
      if (name && !knownSubCommands.has(name)) {
        const forwardArgs = argv.slice(positionalIndex + 1);
        const exitCode = await effectiveOptions.onUnknownSubcommand({
          commandPath: [],
          name,
          args: forwardArgs,
        });
        if (typeof exitCode === "number") {
          await flushStandardStreams();
          // `return` so a mocked process.exit (tests) still short-circuits.
          return process.exit(exitCode);
        }
      }
    }
  }

  // Global setup
  if (effectiveOptions.setup) {
    try {
      await effectiveOptions.setup({});
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (effectiveOptions.cleanup) {
        try {
          await effectiveOptions.cleanup({ error });
        } catch {
          // Swallow cleanup error when setup already failed
        }
      }
      process.exit(1);
    }
  }

  const result = await runCommandInternal(command, argv, {
    debug: effectiveOptions.debug,
    captureLogs: effectiveOptions.captureLogs,
    skipValidation: effectiveOptions.skipValidation,
    handleSignals: true,
    logger: effectiveOptions.logger,
    globalArgs: effectiveOptions.globalArgs,
    prompt: effectiveOptions.prompt,
    onUnknownSubcommand: effectiveOptions.onUnknownSubcommand,
    _globalExtracted: globalExtracted,
    _globalCleanup: effectiveOptions.cleanup,
    _context: {
      commandPath: [],
      rootName: command.name,
      rootVersion: effectiveOptions.version,
      globalExtracted,
    },
  });

  // Display errors (controlled by displayErrors option, default: true)
  if ((effectiveOptions.displayErrors ?? true) && !result.success && result.error) {
    const errorLogger = effectiveOptions.logger ?? defaultLogger;
    errorLogger.error(formatRuntimeError(result.error, effectiveOptions.debug ?? false));
  }

  // Global cleanup (always)
  if (effectiveOptions.cleanup) {
    const cleanupCtx: GlobalCleanupContext = {
      error: !result.success ? result.error : undefined,
    };
    try {
      await effectiveOptions.cleanup(cleanupCtx);
    } catch {
      // Swallow - we're about to exit anyway
    }
  }

  await flushStandardStreams();

  process.exit(result.exitCode);
}

/**
 * Flush stdout/stderr before exit to prevent truncated output when piped
 * (pipe writes are buffered asynchronously, so exiting early loses data).
 *
 * We await a zero-byte write's callback rather than a `drain` event: `drain`
 * only fires after a `write()` returned `false` (backpressure), so buffered
 * writes that never tripped it would hang. The write callback is ordered after
 * all pending writes, so it resolves once the buffer is flushed.
 */
async function flushStandardStreams(): Promise<void> {
  await Promise.all(
    [process.stdout, process.stderr].map((stream) =>
      stream.writableLength > 0
        ? new Promise<void>((resolve) => stream.write("", () => resolve()))
        : Promise.resolve(),
    ),
  );
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

    // Nested plugin dispatch: an unknown positional under a known parent
    // command (e.g. `cli foo bar` -> `cli-foo-bar`). Runs before --help/--version
    // handling so those flags are forwarded to the plugin, mirroring the
    // root-level dispatch in runMain. Root level (empty command path) is handled
    // in runMain before global setup; here we only cover nested levels.
    const nestedCommandPath = context.commandPath ?? [];
    if (options.onUnknownSubcommand && nestedCommandPath.length > 0) {
      const knownSubCommands = listSubCommandNamesWithAliases(command);
      if (knownSubCommands.size > 0) {
        const positionalIndex = findFirstPositionalIndex(argv, options._globalExtracted);
        const name = positionalIndex >= 0 ? argv[positionalIndex] : undefined;
        if (name && !knownSubCommands.has(name)) {
          const forwardArgs = argv.slice(positionalIndex + 1);
          const exitCode = await options.onUnknownSubcommand({
            commandPath: nestedCommandPath,
            name,
            args: forwardArgs,
          });
          if (typeof exitCode === "number") {
            collector?.stop();
            // Real CLI run: exit with the plugin's code. Programmatic callers
            // fall through to the typed result and run cleanup themselves.
            if (options.handleSignals) {
              // Direct exit bypasses runMain's cleanup, and global setup has
              // already run at this nested level, so run cleanup here too.
              if (options._globalCleanup) {
                try {
                  await options._globalCleanup({ error: undefined });
                } catch {
                  // Swallow - we're about to exit anyway.
                }
              }
              await flushStandardStreams();
              // No `return`: a mocked process.exit (tests) must fall through to
              // the typed result so the recursion returns a valid RunResult.
              process.exit(exitCode);
            }
            return exitCode === 0
              ? { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() }
              : {
                  success: false,
                  error: new Error(
                    `Plugin "${[...nestedCommandPath, name].join(" ")}" exited with code ${exitCode}`,
                  ),
                  exitCode,
                  logs: getCurrentLogs(),
                };
          }
        }
      }
    }

    // Handle --help or --help-all
    if (parseResult.helpRequested || parseResult.helpAllRequested) {
      // Check if there's an unknown subcommand specified
      let hasUnknownSubcommand = false;
      const subCmdNames = listSubCommands(command);
      const allSubCmdNameSet = listSubCommandNamesWithAliases(command);
      if (subCmdNames.length > 0) {
        // Find first positional argument (potential subcommand), skipping global option values
        const potentialSubCmd = findFirstPositional(argv, context.globalExtracted);
        if (potentialSubCmd && !allSubCmdNameSet.has(potentialSubCmd)) {
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
        const similar = findSimilar(unknownCmd, [...allSubCmdNameSet]);
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
      // Surface unknown flags from the pre-subcommand portion of argv before
      // descending. Currently these are suppressed default `--no-X` tokens
      // for global fields that declared a custom `negation`; they belong to
      // the global schema, so use the global `unknownKeysMode`.
      if (parseResult.unknownFlags.length > 0) {
        const globalMode = context.globalExtracted?.unknownKeysMode ?? "strip";
        if (globalMode === "strict") {
          collector?.stop();
          return {
            success: false,
            error: new Error(`Unknown flags: ${parseResult.unknownFlags.join(", ")}`),
            exitCode: 1,
            logs: getCurrentLogs(),
          };
        }
        if (globalMode === "strip") {
          const knownGlobalFlags = context.globalExtracted?.fields.map((f) => f.name) ?? [];
          for (const flag of parseResult.unknownFlags) {
            logger.error(formatUnknownFlagWarning(flag, knownGlobalFlags));
          }
        }
        // passthrough: silently ignore
      }

      const resolved = await resolveSubcommandWithAlias(command, parseResult.subCommand);
      if (resolved) {
        // Build new context for subcommand
        const subContext: CommandContext = {
          commandPath: [...(context.commandPath ?? []), parseResult.subCommand],
          rootName: context.rootName,
          rootVersion: context.rootVersion,
          globalExtracted: context.globalExtracted,
          aliasFor: resolved.aliasFor,
        };
        // Stop this collector and pass logs to subcommand
        collector?.stop();
        return runCommandInternal<TResult>(resolved.command, parseResult.remainingArgs, {
          ...options,
          _context: subContext,
          _existingLogs: getCurrentLogs(),
          _parsedGlobalArgs: accumulatedGlobalArgs,
        });
      }
    }

    // Pre-compute positional field metadata shared between the help-fallback
    // guard and the unexpected-positionals check below.
    const positionalFields = parseResult.extractedFields?.fields.filter((f) => f.positional) ?? [];
    const hasArrayPositional = positionalFields.some((f) => f.type === "array");
    const allPositionals = [...parseResult.positionals, ...parseResult.rest];
    const extraPositionals = hasArrayPositional
      ? []
      : allPositionals.slice(positionalFields.length);
    // Only regular positionals (not after --) that don't start with '-' are treated as
    // unknown subcommand attempts. Tokens after -- are explicitly positional by the user,
    // and '-' is a conventional stdin marker, so neither should be misclassified.
    const unconsumedRegulars = parseResult.positionals.slice(positionalFields.length);

    // If command has subcommands but none specified, show help.
    // If there is an unrecognised bare token, fall through so the
    // unexpected-positionals check below surfaces it as "Unknown subcommand".
    const subCmds = listSubCommands(command);
    if (
      subCmds.length > 0 &&
      !parseResult.subCommand &&
      !command.run &&
      !unconsumedRegulars.some((t) => !t.startsWith("-"))
    ) {
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

    // Handle unexpected positionals (tokens not consumed by positional field definitions).
    // allPositionals combines regular positionals with tokens explicitly passed after --,
    // since mergeWithPositionals already consumes both sources in order.
    if (extraPositionals.length > 0) {
      const subCmdNames = listSubCommandNamesWithAliases(command);
      if (subCmdNames.size > 0) {
        const unknownCmd = unconsumedRegulars.find((t) => !t.startsWith("-"));
        if (unknownCmd) {
          const similar = findSimilar(unknownCmd, [...subCmdNames]);
          const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(", ")}?` : "";
          collector?.stop();
          return {
            success: false,
            error: new Error(
              `Unknown subcommand: ${unknownCmd}${suggestion ? `.${suggestion}` : ""}`,
            ),
            exitCode: 1,
            logs: getCurrentLogs(),
          };
        }
      }

      // No subcommands (or all extras are '-'-prefixed / after --): follow schema's unknownKeysMode
      const unknownKeysMode = parseResult.extractedFields?.unknownKeysMode ?? "strip";
      if (unknownKeysMode === "strict") {
        collector?.stop();
        return {
          success: false,
          error: new Error(
            `Unexpected positional argument${extraPositionals.length > 1 ? "s" : ""}: ${extraPositionals.join(", ")}`,
          ),
          exitCode: 1,
          logs: getCurrentLogs(),
        };
      } else if (unknownKeysMode === "strip") {
        for (const positional of extraPositionals) {
          logger.error(`Warning: Unexpected positional argument: ${positional}`);
        }
        // Continue execution
      }
      // passthrough: silently ignore
    }

    // Validate global args at the leaf command level. The internal
    // `__complete` command is the exception: shell scripts invoke
    // `mycli __complete --shell <s> -- <partial input>` whenever the
    // user TABs, and the partial input may legitimately omit required
    // globals — completion needs to fire *before* the user finishes
    // typing them. Skip global validation here so resolvers always
    // receive a context, even when the typed line is not yet valid.
    let validatedGlobalArgs: Record<string, unknown> = {};
    const isCompletionInvocation = command.name === "__complete";
    if (options.globalArgs && options._globalExtracted && !isCompletionInvocation) {
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

      // Prompt for missing global args (if prompt resolver is provided)
      if (options.prompt) {
        const resolved = await options.prompt(accumulatedGlobalArgs, options._globalExtracted);
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
      if (options._globalExtracted && !isCompletionInvocation) {
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

    // Prompt for missing command args (if prompt resolver is provided)
    let argsToValidate = parseResult.rawArgs;
    if (options.prompt && parseResult.extractedFields) {
      const resolved = await options.prompt(argsToValidate, parseResult.extractedFields);
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
    if (options._globalExtracted && !isCompletionInvocation) {
      await runEffects(proxiedGlobalArgs, options._globalExtracted, proxiedGlobalArgs);
    }
    if (parseResult.extractedFields && !isCompletionInvocation) {
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
    validateDuplicateNegations(extracted);
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
