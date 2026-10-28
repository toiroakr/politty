import { isDeepStrictEqual } from "node:util";
import type { ResolvedFieldMeta } from "../adapter/field-meta.js";
import { mergeNestedArgs } from "../adapter/unflatten.js";
import { detectAgent, type AgentInfo } from "../agent/detect-agent.js";
import { enableCompileCache } from "../compile-cache.js";
import { executeLifecycle } from "../executor/command-runner.js";
import { createLogCollector, emptyLogs, mergeLogs } from "../executor/log-collector.js";
import {
  listSubCommandNamesWithAliases,
  listSubCommands,
  resolveLazyCommand,
  resolveSubCommandAlias,
  resolveSubcommandWithAlias,
} from "../executor/subcommand-router.js";
import { resolveSubCommandMeta } from "../lazy.js";
import { generateHelp, generateHelpData, type CommandContext } from "../output/help-generator.js";
import { applyEnvFallbacks, parseArgs } from "../parser/arg-parser.js";
import { getLongOptionName } from "../parser/long-option-resolver.js";
import { findFirstPositional, findFirstPositionalIndex } from "../parser/subcommand-scanner.js";
import type {
  AnyCommand,
  ArgSource,
  ArgsSchema,
  CollectedLogs,
  GlobalCleanupContext,
  InternalRunOptions,
  Logger,
  MainOptions,
  RunCommandOptions,
  RunInvocation,
  RunResult,
} from "../types.js";
import {
  formatValidationErrors as formatPlainValidationErrors,
  validateArgs,
} from "../validator/args-validator.js";
import {
  validateCaseVariantCollisions,
  validateDefaultSubCommand,
  validateDuplicateAliases,
  validateDuplicateFields,
  validateDuplicateNegations,
  validateReservedAliases,
  validateReservedFieldNames,
} from "../validator/command-validator.js";
import {
  findSimilar,
  formatRuntimeError,
  formatUnknownFlagWarning,
} from "../validator/error-formatter.js";
import { createDualCaseProxy } from "./case-proxy.js";
import { runEffects } from "./effect-runner.js";
import {
  extractFields,
  selectAcceptingUnionOption,
  selectDiscriminatedVariant,
  toCamelCase,
  toKebabCase,
  type ExtractedFields,
} from "./schema-extractor.js";

/**
 * Default logger using console
 */
const defaultLogger: Logger = {
  log: (message: string) => console.log(message),
  error: (message: string) => console.error(message),
  warn: (message: string) => console.warn(message),
};

/**
 * Exit code for an invalid command line, kept apart from the `1` of failures
 * while running (the usage-error code of shell builtins and argparse).
 */
const USAGE_ERROR_EXIT_CODE = 2;

/**
 * Copy parser-supplied values before a prompt resolver runs. A resolver may
 * mutate an array/object value in place, which a shallow copy would not
 * notice since both sides share the reference.
 */
function snapshotArgs(args: Record<string, unknown>): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    try {
      snapshot[key] = structuredClone(value);
    } catch {
      snapshot[key] = value;
    }
  }
  return snapshot;
}

/**
 * Attach a non-enumerable `$source` helper to the final args object so it
 * stays invisible to `Object.keys`/`JSON.stringify`/spread (those only ever
 * see real field values) while still being reachable via property access
 * (including through `createDualCaseProxy`).
 */
function attachArgSource(target: Record<string, unknown>, sourceMap: Map<string, ArgSource>): void {
  Object.defineProperty(target, "$source", {
    // `sourceMap` is keyed by the field's canonical schema name, which may
    // itself be camelCase or kebab-case. Since `createDualCaseProxy` lets
    // callers query either case variant, try the name as-is and both
    // normalized forms so `$source` agrees with dual-case property access.
    value: (name: string): ArgSource =>
      sourceMap.get(name) ??
      sourceMap.get(toCamelCase(name)) ??
      sourceMap.get(toKebabCase(name)) ??
      "default",
    enumerable: false,
  });
}

/**
 * Classify global fields for `$source`. Later sources win: an env fallback
 * fills a field the CLI left empty, and a prompt answer overrides both.
 */
function buildGlobalSourceMap(
  cliProvided: Iterable<string>,
  envFallback: Iterable<string>,
  prompted: Iterable<string>,
): Map<string, ArgSource> {
  const sourceMap = new Map<string, ArgSource>();
  for (const name of cliProvided) sourceMap.set(name, "cli");
  for (const name of envFallback) sourceMap.set(name, "env");
  for (const name of prompted) sourceMap.set(name, "prompt");
  return sourceMap;
}

/**
 * Attach a non-enumerable `$invocation` helper to the final args object,
 * mirroring `attachArgSource`'s visibility (invisible to `Object.keys`/
 * `JSON.stringify`/spread, reachable via property access through
 * `createDualCaseProxy`).
 */
function attachInvocation(target: Record<string, unknown>, invocation: RunInvocation): void {
  Object.defineProperty(target, "$invocation", {
    value: invocation,
    enumerable: false,
  });
}

/**
 * Attach a non-enumerable `$agent` value to the final args object, mirroring
 * `attachInvocation`'s visibility.
 */
function attachAgent(target: Record<string, unknown>, agent: AgentInfo | undefined): void {
  Object.defineProperty(target, "$agent", {
    value: agent,
    enumerable: false,
  });
}

/**
 * Pass the detected agent to a global cleanup hook, so every internal caller
 * (normal exit, setup failure, signal, plugin dispatch) only supplies `error`.
 */
function bindAgentToCleanup(
  cleanup: ((context: GlobalCleanupContext) => void | Promise<void>) | undefined,
  agent: AgentInfo | undefined,
): ((context: GlobalCleanupContext) => void | Promise<void>) | undefined {
  return cleanup && ((context) => cleanup({ ...context, agent }));
}

/**
 * Recover the validated global values after a run failed before the global
 * effects ran. Unknown flags are left out and a value that fails its own
 * validation is dropped (so its default applies) until the schema accepts
 * what remains; a schema that still fails, such as one missing a required
 * global value, yields undefined.
 */
function recoverGlobalArgs(
  trace: GlobalTrace,
  schema: ArgsSchema,
  extracted: ExtractedFields,
): Record<string, unknown> | undefined {
  if (!trace.rawGlobalArgs) return undefined;
  const known = new Set(extracted.fields.map((field) => field.name));
  const candidate: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(trace.rawGlobalArgs)) {
    if (known.has(name)) candidate[name] = value;
  }
  const cliProvided = new Set(Object.keys(candidate));
  const envFallbackFields = applyEnvFallbacks(candidate, extracted);
  for (const [name, value] of Object.entries(trace.promptedGlobalArgs ?? {})) {
    if (!known.has(name)) continue;
    envFallbackFields.delete(name);
    if (value === undefined) {
      delete candidate[name];
      cliProvided.delete(name);
      continue;
    }
    candidate[name] = value;
  }
  for (let attempt = 0; attempt <= known.size; attempt++) {
    const validation = validateArgs(candidate, schema);
    if (validation.success) {
      const recovered = validation.data as Record<string, unknown>;
      const sourceMap = new Map<string, ArgSource>();
      for (const name of cliProvided) if (name in candidate) sourceMap.set(name, "cli");
      for (const name of envFallbackFields) if (name in candidate) sourceMap.set(name, "env");
      for (const [name, value] of Object.entries(trace.promptedGlobalArgs ?? {})) {
        if (value !== undefined && name in candidate) sourceMap.set(name, "prompt");
      }
      attachArgSource(recovered, sourceMap);
      return createDualCaseProxy(recovered);
    }
    let invalid = validation.errors
      .map((error) => error.path[0])
      .filter((name): name is string => name !== undefined && Object.hasOwn(candidate, name));
    if (invalid.length === 0) {
      // An error without a field path (a union of objects) names no culprit. Recover only
      // when exactly one removal lets the schema accept the rest: with several, the choice
      // would depend on argument order and could switch to another union branch.
      const culprits = Object.keys(candidate).filter((name) => {
        const { [name]: _removed, ...rest } = candidate;
        return validateArgs(rest, schema).success;
      });
      if (culprits.length !== 1) return undefined;
      invalid = culprits;
    }
    for (const name of invalid) delete candidate[name];
  }
  return undefined;
}

function buildCleanupContext(
  result: { success: boolean; error?: Error | undefined },
  trace: GlobalTrace,
  globalArgs: ArgsSchema | undefined,
  extracted: ExtractedFields | undefined,
): GlobalCleanupContext {
  const error = !result.success ? result.error : undefined;
  if (result.success || trace.effectsRan || !globalArgs || !extracted) return { error };
  try {
    return { error, globalArgs: recoverGlobalArgs(trace, globalArgs, extracted) };
  } catch {
    return { error };
  }
}

/**
 * Resolve the agent-only help preamble for the command whose help is shown.
 */
function resolveAgentHelp(
  options: InternalCommandOptions,
  context: CommandContext,
): string | undefined {
  const { agentHelp, _agent: agent } = options;
  if (!agentHelp || !agent) return undefined;
  return typeof agentHelp === "string"
    ? agentHelp
    : agentHelp({ agent, commandPath: context.commandPath ?? [] });
}

/**
 * Resolve the `RunInvocation` metadata for the command about to run: the
 * literal CLI token that reached it (canonical name or alias), and the
 * canonical name if that token was an alias.
 *
 * `context.commandPath`'s last entry is the raw token a parent recorded
 * when descending into this command (see the subcommand-descent branch
 * below); it falls back to `command.name` for the root command or a
 * directly-invoked command (no subcommand routing took place).
 */
function resolveInvocation(command: AnyCommand, context: CommandContext): RunInvocation {
  const name = context.commandPath?.at(-1) ?? command.name;
  return context.aliasFor ? { name, aliasFor: context.aliasFor } : { name };
}

/**
 * Internal options for runCommand (includes context tracking)
 */
interface InternalCommandOptions extends InternalRunOptions {
  _metadataOnly?: boolean | undefined;
  /** Command hierarchy context (internal use) */
  _context?: CommandContext | undefined;
  /** Existing logs to include (for subcommand routing) */
  _existingLogs?: CollectedLogs | undefined;
  /** Extracted fields from global args schema */
  _globalExtracted?: ExtractedFields | undefined;
  /** Already parsed global args (accumulated from parent levels) */
  _parsedGlobalArgs?: Record<string, unknown> | undefined;
  /** Option tokens consumed before subcommand names at parent levels (for plugin dispatch) */
  _precedingArgs?: readonly string[] | undefined;
  /** Global cleanup hook for signal handling */
  _globalCleanup?: ((context: GlobalCleanupContext) => void | Promise<void>) | undefined;
  /** AI coding agent detected once per run */
  _agent?: AgentInfo | undefined;
  /** Receives the global args of the deepest level reached, for recovery after a failure */
  _globalTrace?: GlobalTrace | undefined;
}

interface GlobalTrace {
  rawGlobalArgs?: Record<string, unknown> | undefined;
  promptedGlobalArgs?: Record<string, unknown> | undefined;
  effectsRan?: boolean | undefined;
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
  const agent = detectAgent();
  const globalCleanup = bindAgentToCleanup(options.cleanup, agent);

  // Start log collection for global setup/cleanup if enabled
  const shouldCaptureLogs = options.captureLogs ?? false;
  const globalCollector = shouldCaptureLogs ? createLogCollector() : null;

  // Global setup
  if (options.setup) {
    globalCollector?.start();
    try {
      await options.setup({ agent });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (globalCleanup) {
        try {
          await globalCleanup({ error });
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

  const globalTrace: GlobalTrace = {};
  const result = await runCommandInternal<TResult>(command, argv, {
    ...options,
    handleSignals: false,
    _globalExtracted: globalExtracted,
    _globalCleanup: globalCleanup,
    _existingLogs: globalCollector?.getLogs(),
    _agent: agent,
    _globalTrace: globalTrace,
  });

  // Global cleanup (always)
  if (globalCleanup) {
    const cleanupCollector = shouldCaptureLogs ? createLogCollector() : null;
    cleanupCollector?.start();
    const cleanupCtx = buildCleanupContext(
      result,
      globalTrace,
      options.globalArgs,
      globalExtracted,
    );
    try {
      await globalCleanup(cleanupCtx);
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
  return Object.hasOwn(command.subCommands ?? {}, firstPositional);
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
  // Enable the on-disk V8 compile cache before anything is dynamically
  // imported so `lazy()` subcommands and adapter modules skip recompilation
  // on warm starts. The entry's static import graph is compiled before user
  // code runs and is out of reach here — the `compile-cache` subpath's
  // bin-shim pattern covers that part.
  if (options.compileCache !== false) {
    enableCompileCache(
      typeof options.compileCache === "string"
        ? { cacheDir: options.compileCache }
        : { programName: command.name },
    );
  }

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
  const agent = detectAgent();
  const globalCleanup = bindAgentToCleanup(effectiveOptions.cleanup, agent);

  // Validate the root command's own `defaultSubCommand` before plugin dispatch
  // below: that dispatch can `process.exit` before ever reaching
  // `runCommandInternal` (where this same check also runs for every other
  // command in the tree), so a misconfigured root would otherwise only
  // surface when a positional happened not to trigger plugin dispatch.
  if (!effectiveOptions.skipValidation) {
    validateDefaultSubCommand(command);
  }

  // Plugin dispatch: when the first positional is not a known subcommand and a
  // handler is registered, delegate to it (e.g. exec an external `<cli>-<name>`
  // binary). Runs before global setup/cleanup so plugins are independent of the
  // host CLI's lifecycle, and is skipped for internal (`__*`) invocations.
  // Commands with their own `run` are excluded: their first positional is a
  // real argument, so an installed plugin must never shadow it (which would
  // make the command's meaning depend on what is on PATH).
  if (
    effectiveOptions.onUnknownSubcommand &&
    !command.run &&
    !isInternalSubcommandInvocation(command, argv, globalExtractedForBypass)
  ) {
    const knownSubCommands = listSubCommandNamesWithAliases(command);
    if (knownSubCommands.size > 0) {
      const positionalIndex = findFirstPositionalIndex(argv, globalExtracted, {
        stopOnSuppressedNegation: globalExtracted?.unknownKeysMode !== "passthrough",
      });
      const name = positionalIndex >= 0 ? argv[positionalIndex] : undefined;
      if (name && !knownSubCommands.has(name)) {
        const forwardArgs = argv.slice(positionalIndex + 1);
        const exitCode = await effectiveOptions.onUnknownSubcommand({
          commandPath: [],
          name,
          args: forwardArgs,
          precedingArgs: argv.slice(0, positionalIndex),
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
      await effectiveOptions.setup({ agent });
    } catch (e) {
      const error = e instanceof Error ? e : new Error(String(e));
      if (globalCleanup) {
        try {
          await globalCleanup({ error });
        } catch {
          // Swallow cleanup error when setup already failed
        }
      }
      process.exit(1);
    }
  }

  const globalTrace: GlobalTrace = {};
  const result = await runCommandInternal(command, argv, {
    debug: effectiveOptions.debug,
    captureLogs: effectiveOptions.captureLogs,
    skipValidation: effectiveOptions.skipValidation,
    handleSignals: true,
    logger: effectiveOptions.logger,
    globalArgs: effectiveOptions.globalArgs,
    prompt: effectiveOptions.prompt,
    onUnknownSubcommand: effectiveOptions.onUnknownSubcommand,
    agentHelp: effectiveOptions.agentHelp,
    _globalExtracted: globalExtracted,
    _globalCleanup: globalCleanup,
    _agent: agent,
    _globalTrace: globalTrace,
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
  if (globalCleanup) {
    const cleanupCtx = buildCleanupContext(
      result,
      globalTrace,
      effectiveOptions.globalArgs,
      globalExtracted,
    );
    try {
      await globalCleanup(cleanupCtx);
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
    if (!options.skipValidation) {
      validateDefaultSubCommand(command);
    }

    // Parse arguments
    const parseResult = parseArgs(argv, command, {
      skipValidation: options.skipValidation,
      globalExtracted: options._globalExtracted,
      promptAvailable: options.prompt !== undefined,
      inheritedNames: new Set(Object.keys(options._parsedGlobalArgs ?? {})),
    });

    // Accumulate global args from this parse level.
    // Note: uses shallow spread, so array-valued globals split across a subcommand
    // boundary (e.g., `cli --tag a sub --tag b`) will only keep the later value.
    const accumulatedGlobalArgs = {
      ...options._parsedGlobalArgs,
      ...parseResult.rawGlobalArgs,
    };
    if (options._globalTrace) options._globalTrace.rawGlobalArgs = { ...accumulatedGlobalArgs };

    // Nested plugin dispatch: an unknown positional under a known parent
    // command (e.g. `cli foo bar` -> `cli-foo-bar`). Runs before --help/--version
    // handling so those flags are forwarded to the plugin, mirroring the
    // root-level dispatch in runMain. Root level (empty command path) is handled
    // in runMain before global setup; here we only cover nested levels.
    // Commands with their own `run` are excluded so a plugin on PATH can never
    // shadow a real positional argument (see the root-level dispatch above).
    const nestedCommandPath = context.commandPath ?? [];
    if (options.onUnknownSubcommand && !command.run && nestedCommandPath.length > 0) {
      const knownSubCommands = listSubCommandNamesWithAliases(command);
      if (knownSubCommands.size > 0) {
        const positionalIndex = findFirstPositionalIndex(argv, options._globalExtracted, {
          stopOnSuppressedNegation: options._globalExtracted?.unknownKeysMode !== "passthrough",
        });
        const name = positionalIndex >= 0 ? argv[positionalIndex] : undefined;
        if (name && !knownSubCommands.has(name)) {
          const forwardArgs = argv.slice(positionalIndex + 1);
          const exitCode = await options.onUnknownSubcommand({
            commandPath: nestedCommandPath,
            name,
            args: forwardArgs,
            precedingArgs: [...(options._precedingArgs ?? []), ...argv.slice(0, positionalIndex)],
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

    // Handle --help, --help-all, or --help-json
    if (
      parseResult.helpRequested ||
      parseResult.helpAllRequested ||
      parseResult.helpJsonRequested
    ) {
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

      const agentHelp = resolveAgentHelp(options, context);
      if (parseResult.helpJsonRequested) {
        const helpData = generateHelpData(command, { context, agentHelp });
        logger.log(JSON.stringify(helpData));
      } else {
        const help = generateHelp(command, {
          showSubcommands: options.showSubcommands ?? true,
          showSubcommandOptions: parseResult.helpAllRequested || options.showSubcommandOptions,
          context,
          agentHelp,
        });
        logger.log(help);
      }
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
          exitCode: USAGE_ERROR_EXIT_CODE,
          logs: getCurrentLogs(),
        };
      }
      return { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() };
    }

    // Suppressed default `--no-X` tokens for global fields belong to the
    // global schema, so honor its unknownKeysMode before version handling or
    // subcommand descent can bypass strict handling. Help is handled first so
    // it remains available even when argv also contains an unknown global flag.
    if (parseResult.unknownGlobalFlags && parseResult.unknownGlobalFlags.length > 0) {
      const globalMode = context.globalExtracted?.unknownKeysMode ?? "strip";
      if (globalMode === "strict") {
        collector?.stop();
        return {
          success: false,
          error: new Error(`Unknown flags: ${parseResult.unknownGlobalFlags.join(", ")}`),
          exitCode: USAGE_ERROR_EXIT_CODE,
          logs: getCurrentLogs(),
        };
      }
      if (globalMode === "strip") {
        const knownGlobalFlags = context.globalExtracted?.fields.map((f) => f.name) ?? [];
        for (const flag of parseResult.unknownGlobalFlags) {
          logger.error(formatUnknownFlagWarning(flag, knownGlobalFlags));
        }
      }
      // passthrough: silently ignore
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
      let metadataOnly = options._metadataOnly ?? false;
      const resolved = await resolveSubcommandWithAlias(command, parseResult.subCommand, (meta) => {
        if (metadataOnly) return true;
        if (!meta.requiredPackages?.length) return false;
        let target = meta;
        let remainingArgs = parseResult.remainingArgs;
        while (true) {
          const preview = parseArgs(remainingArgs, target, {
            skipValidation: options.skipValidation,
            globalExtracted: context.globalExtracted,
            promptAvailable: !!options.prompt,
          });
          if (
            preview.helpRequested ||
            preview.helpAllRequested ||
            preview.helpJsonRequested ||
            preview.versionRequested
          ) {
            metadataOnly = true;
            return true;
          }
          if (!preview.subCommand || !target.subCommands) return false;
          const name = Object.hasOwn(target.subCommands, preview.subCommand)
            ? preview.subCommand
            : (resolveSubCommandAlias(target, preview.subCommand) ?? preview.subCommand);
          const subCommand = target.subCommands[name];
          const subMeta = subCommand ? resolveSubCommandMeta(subCommand) : null;
          if (!subMeta) return false;
          target = subMeta;
          remainingArgs = preview.remainingArgs;
        }
      });
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
        // Tokens before the subcommand name (remainingArgs is the argv suffix
        // after the name), accumulated for nested plugin dispatch. Suppressed
        // global flags (recorded by name, without dashes) are dropped outside
        // passthrough mode: the host's strip/strict policy rejected them, so
        // they must not be forwarded.
        const suppressedNames = new Set(
          options._globalExtracted?.unknownKeysMode === "passthrough"
            ? []
            : (parseResult.unknownGlobalFlags ?? []),
        );
        const isSuppressedFlag = (token: string): boolean => {
          return token.startsWith("--") && suppressedNames.has(getLongOptionName(token));
        };
        const levelPrecedingArgs = argv
          .slice(0, argv.length - parseResult.remainingArgs.length - 1)
          .filter((token) => !isSuppressedFlag(token));
        return runCommandInternal<TResult>(resolved.command, parseResult.remainingArgs, {
          ...options,
          _metadataOnly: metadataOnly,
          _context: subContext,
          _existingLogs: getCurrentLogs(),
          _parsedGlobalArgs: accumulatedGlobalArgs,
          _precedingArgs: [...(options._precedingArgs ?? []), ...levelPrecedingArgs],
        });
      }
    }

    // Pre-compute positional field metadata shared between the help-fallback
    // guard and the unexpected-positionals check below.
    const positionalFields = parseResult.positionalSlotFields ?? [];
    const hasArrayPositional = positionalFields.some((f) => f.type === "array");
    const allPositionals = [...parseResult.positionals, ...parseResult.rest];
    const extraPositionals = hasArrayPositional
      ? []
      : allPositionals.slice(positionalFields.length);
    // Only regular positionals (not after --) that don't start with '-' are treated as
    // unknown subcommand attempts. Tokens after -- are explicitly positional by the user,
    // and '-' is a conventional stdin marker, so neither should be misclassified.
    const unconsumedRegulars = hasArrayPositional
      ? []
      : parseResult.positionals.slice(positionalFields.length);

    if (parseResult.matchesNoUnionOption) {
      collector?.stop();
      return {
        success: false,
        error: new Error(
          "Arguments match none of the accepted forms. See --help for the accepted forms.",
        ),
        exitCode: USAGE_ERROR_EXIT_CODE,
        logs: getCurrentLogs(),
      };
    }

    // Reported before unknown flags, which are likely meant for the mistyped subcommand.
    const subCmdNames = listSubCommandNamesWithAliases(command);
    const unknownCmd =
      subCmdNames.size > 0
        ? unconsumedRegulars.find((t) => !t.startsWith("-") && !subCmdNames.has(t))
        : undefined;
    if (unknownCmd) {
      const similar = findSimilar(unknownCmd, [...subCmdNames]);
      const suggestion = similar.length > 0 ? ` Did you mean: ${similar.join(", ")}?` : "";
      collector?.stop();
      return {
        success: false,
        error: new Error(`Unknown subcommand: ${unknownCmd}${suggestion ? `.${suggestion}` : ""}`),
        exitCode: USAGE_ERROR_EXIT_CODE,
        logs: getCurrentLogs(),
      };
    }

    // Handle unknown flags based on schema's unknownKeysMode
    if (parseResult.unknownFlags.length > 0) {
      // A group without its own args accepts only global options, so the global schema decides.
      const unknownKeysMode =
        parseResult.extractedFields?.unknownKeysMode ??
        context.globalExtracted?.unknownKeysMode ??
        "strip";
      const knownFlags =
        parseResult.optionFields?.map((f) => f.name) ??
        context.globalExtracted?.fields.map((f) => f.name) ??
        [];

      if (unknownKeysMode === "strict") {
        // strict mode: treat unknown flags as errors
        collector?.stop();
        return {
          success: false,
          error: new Error(`Unknown flags: ${parseResult.unknownFlags.join(", ")}`),
          exitCode: USAGE_ERROR_EXIT_CODE,
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

    // If command has subcommands but none specified, either route to
    // `defaultSubCommand` (if set) or show help.
    // If there are any unconsumed positionals (including tokens after --), fall
    // through so the unexpected-positionals check below surfaces them.
    const subCmds = listSubCommands(command);
    if (
      subCmds.length > 0 &&
      !parseResult.subCommand &&
      !command.run &&
      extraPositionals.length === 0
    ) {
      if (command.defaultSubCommand) {
        // Only absent when `defaultSubCommand` names a key that isn't
        // actually in `subCommands` — normally caught above by
        // `validateDefaultSubCommand`, but reachable with
        // `skipValidation: true` on a misconfigured command. Fall through
        // to help instead of crashing on a bad lookup in that case.
        const defaultSubCommandTarget = command.subCommands?.[command.defaultSubCommand];
        if (defaultSubCommandTarget) {
          const resolvedDefault = await resolveLazyCommand(defaultSubCommandTarget);
          const subContext: CommandContext = {
            commandPath: [...(context.commandPath ?? []), command.defaultSubCommand],
            rootName: context.rootName,
            rootVersion: context.rootVersion,
            globalExtracted: context.globalExtracted,
          };
          collector?.stop();
          // Nothing was typed for the subcommand name itself, so forward no
          // argv (mirroring `tokensAfterSubcommand` for an explicitly-typed
          // name at the very end of argv); every token the user did type at
          // this level was already folded into `accumulatedGlobalArgs` above
          // and is inherited via `_parsedGlobalArgs`, unlike a hand-rolled
          // `runCommand(defaultCmd, [])` call which would discard it.
          // Suppressed global negations (recorded by name, without dashes)
          // are dropped outside passthrough mode, mirroring the explicit
          // subcommand-descent branch above: the host's strip/strict policy
          // already rejected them, so they must not be forwarded.
          const suppressedNames = new Set(
            options._globalExtracted?.unknownKeysMode === "passthrough"
              ? []
              : (parseResult.unknownGlobalFlags ?? []),
          );
          const isSuppressedFlag = (token: string): boolean =>
            token.startsWith("--") && suppressedNames.has(getLongOptionName(token));
          const levelPrecedingArgs = argv.filter((token) => !isSuppressedFlag(token));
          return runCommandInternal<TResult>(resolvedDefault, [], {
            ...options,
            _context: subContext,
            _existingLogs: getCurrentLogs(),
            _parsedGlobalArgs: accumulatedGlobalArgs,
            _precedingArgs: [...(options._precedingArgs ?? []), ...levelPrecedingArgs],
          });
        }
      }

      if (options.globalArgs && options._globalExtracted) {
        const providedGlobalArgs = { ...accumulatedGlobalArgs };
        applyEnvFallbacks(providedGlobalArgs, options._globalExtracted);
        const globalValidation = validateArgs(providedGlobalArgs, options.globalArgs);
        // A missing required global option must not keep a bare group from showing its help.
        const valueErrors = globalValidation.success
          ? []
          : globalValidation.errors.filter(
              (e) => e.path[0] && providedGlobalArgs[e.path[0]] !== undefined,
            );
        if (valueErrors.length > 0) {
          collector?.stop();
          return {
            success: false,
            error: new Error(formatPlainValidationErrors(valueErrors)),
            exitCode: USAGE_ERROR_EXIT_CODE,
            logs: getCurrentLogs(),
          };
        }
      }

      const help = generateHelp(command, {
        showSubcommands: options.showSubcommands ?? true,
        context,
        agentHelp: resolveAgentHelp(options, context),
      });
      logger.log(help);
      collector?.stop();
      return { success: true, result: undefined, exitCode: 0, logs: getCurrentLogs() };
    }

    // Handle unexpected positionals (tokens not consumed by positional field definitions).
    // allPositionals combines regular positionals with tokens explicitly passed after --,
    // since mergeWithPositionals already consumes both sources in order.
    if (extraPositionals.length > 0) {
      // No subcommands (or all extras are '-'-prefixed / after --): follow schema's unknownKeysMode
      const unknownKeysMode = parseResult.extractedFields?.unknownKeysMode ?? "strip";
      if (unknownKeysMode === "strict") {
        collector?.stop();
        return {
          success: false,
          error: new Error(
            `Unexpected positional argument${extraPositionals.length > 1 ? "s" : ""}: ${extraPositionals.join(", ")}`,
          ),
          exitCode: USAGE_ERROR_EXIT_CODE,
          logs: getCurrentLogs(),
        };
      } else if (unknownKeysMode === "strip") {
        for (const positional of extraPositionals) {
          (logger.warn ?? logger.error)(`Warning: Unexpected positional argument: ${positional}`);
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
    // Snapshot which global fields came from the CLI (this level or an
    // ancestor's) before env fallbacks below mutate accumulatedGlobalArgs.
    const cliProvidedGlobalFields = new Set(Object.keys(accumulatedGlobalArgs));
    let envFallbackGlobalFields = new Set<string>();
    let promptedGlobalFields = new Set<string>();
    if (options.globalArgs && options._globalExtracted && !isCompletionInvocation) {
      envFallbackGlobalFields = applyEnvFallbacks(accumulatedGlobalArgs, options._globalExtracted);

      // Prompt for missing global args (if prompt resolver is provided).
      // A resolver may return `{ field: undefined }` for a field it chose
      // not to prompt for; that isn't an explicit value, so don't let it
      // clobber a real CLI/env value already in accumulatedGlobalArgs (see
      // the identical local-args handling below for the same rationale).
      if (options.prompt) {
        const beforePrompt = snapshotArgs(accumulatedGlobalArgs);
        try {
          const resolved = await options.prompt(accumulatedGlobalArgs, options._globalExtracted, {
            globalArgs: accumulatedGlobalArgs,
          });
          for (const [key, value] of Object.entries(resolved)) {
            if (value !== undefined) accumulatedGlobalArgs[key] = value;
          }
        } finally {
          // Also runs when the resolver throws after mutating in place, so
          // the `globalArgs` recovered for `cleanup` still sees its answers.
          // A field the resolver cleared is kept as `undefined`: it no longer
          // came from the CLI or env, and the schema default applies instead.
          const prompted: Record<string, unknown> = {};
          for (const key of new Set([
            ...Object.keys(beforePrompt),
            ...Object.keys(accumulatedGlobalArgs),
          ])) {
            const value = accumulatedGlobalArgs[key];
            if (isDeepStrictEqual(beforePrompt[key], value)) continue;
            prompted[key] = value;
            if (value === undefined) {
              cliProvidedGlobalFields.delete(key);
              envFallbackGlobalFields.delete(key);
            }
          }
          promptedGlobalFields = new Set(
            Object.keys(prompted).filter((key) => prompted[key] !== undefined),
          );
          if (options._globalTrace) options._globalTrace.promptedGlobalArgs = prompted;
        }
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
          exitCode: USAGE_ERROR_EXIT_CODE,
          logs: getCurrentLogs(),
        };
      }
      validatedGlobalArgs = globalValidation.data as Record<string, unknown>;
    }

    // Validate arguments
    if (!command.args) {
      // No schema, run with global args (or empty args)
      const globalSourceMap = buildGlobalSourceMap(
        cliProvidedGlobalFields,
        envFallbackGlobalFields,
        promptedGlobalFields,
      );
      attachArgSource(validatedGlobalArgs, globalSourceMap);
      attachInvocation(validatedGlobalArgs, resolveInvocation(command, context));
      attachAgent(validatedGlobalArgs, options._agent);
      const proxiedGlobalArgs = createDualCaseProxy(validatedGlobalArgs);
      if (options._globalExtracted && !isCompletionInvocation) {
        if (options._globalTrace) options._globalTrace.effectsRan = true;
        await runEffects(proxiedGlobalArgs, options._globalExtracted, proxiedGlobalArgs);
      }
      collector?.stop();
      const mergedArgs = proxiedGlobalArgs as Record<string, never>;
      const result = await executeLifecycle(command, mergedArgs, {
        handleSignals: options.handleSignals,
        captureLogs: options.captureLogs,
        existingLogs: getCurrentLogs(),
        globalCleanup: options._globalCleanup,
        packageDiscriminators: options._globalExtracted?.discriminator
          ? [options._globalExtracted.discriminator]
          : [],
        packageFields:
          isCompletionInvocation || !options._globalExtracted
            ? undefined
            : selectDiscriminatedVariant(options._globalExtracted, () => validatedGlobalArgs)
                .fields,
      });
      return result as RunResult<TResult>;
    }

    let argsToValidate = parseResult.rawArgs;
    // Snapshot the keys the parser supplied (CLI or env) before a prompt
    // resolver runs: a resolver may answer by mutating `rawArgs` in place,
    // and such answers must be classified like returned ones, not as CLI.
    const parserRawArgs = options.prompt ? snapshotArgs(parseResult.rawArgs) : parseResult.rawArgs;
    const hasParserValue = (name: string): boolean => Object.hasOwn(parserRawArgs, name);

    // Prompt for missing command args (if prompt resolver is provided)
    const promptResolvedFields = new Set<string>();
    if (options.prompt && parseResult.extractedFields) {
      const resolved = await options.prompt(argsToValidate, parseResult.extractedFields, {
        globalArgs: validatedGlobalArgs,
      });
      // A resolver may return `{ field: undefined }` for a field it chose
      // not to prompt for; that isn't an explicit value, so skip it here
      // instead of spreading it in verbatim -- otherwise it would clobber a
      // real CLI/env value already in argsToValidate.
      const nextArgsToValidate = { ...argsToValidate };
      for (const [key, value] of Object.entries(resolved)) {
        if (value !== undefined) nextArgsToValidate[key] = value;
      }
      argsToValidate = nextArgsToValidate;
      // Built-in resolvers echo parser values back, so only a value the
      // parser did not supply (or a changed one) counts as a prompt answer.
      for (const [key, value] of Object.entries(argsToValidate)) {
        if (
          value !== undefined &&
          (!hasParserValue(key) || !isDeepStrictEqual(parserRawArgs[key], value))
        ) {
          promptResolvedFields.add(key);
        }
      }
    }

    const validationResult = validateArgs(argsToValidate, command.args);

    if (!validationResult.success) {
      collector?.stop();
      return {
        success: false,
        error: new Error(formatPlainValidationErrors(validationResult.errors)),
        exitCode: USAGE_ERROR_EXIT_CODE,
        logs: getCurrentLogs(),
      };
    }

    // Wrap validated args with dual-case proxy before effects and execution
    const proxiedCommandArgs = createDualCaseProxy(
      validationResult.data as Record<string, unknown>,
    );
    // Global effects run before the merged args exist, so attach the global
    // run metadata here: a global effect must see the same `$source` whether
    // or not the invoked command declares args of its own.
    const globalSourceMap = buildGlobalSourceMap(
      cliProvidedGlobalFields,
      envFallbackGlobalFields,
      promptedGlobalFields,
    );
    attachArgSource(validatedGlobalArgs, globalSourceMap);
    attachInvocation(validatedGlobalArgs, resolveInvocation(command, context));
    attachAgent(validatedGlobalArgs, options._agent);
    const proxiedGlobalArgs = createDualCaseProxy(validatedGlobalArgs);

    // Run effects after all validations succeed (global effects first, then command effects)
    if (options._globalExtracted && !isCompletionInvocation) {
      if (options._globalTrace) options._globalTrace.effectsRan = true;
      await runEffects(proxiedGlobalArgs, options._globalExtracted, proxiedGlobalArgs);
    }
    const acceptedFields = parseResult.extractedFields
      ? selectAcceptingUnionOption(
          parseResult.extractedFields,
          (schema) => validateArgs(argsToValidate, schema).success,
        )
      : undefined;
    if (acceptedFields && !isCompletionInvocation) {
      await runEffects(proxiedCommandArgs, acceptedFields, proxiedGlobalArgs);
    }
    const acceptedField = (field: ResolvedFieldMeta): ResolvedFieldMeta =>
      (acceptedFields !== parseResult.extractedFields
        ? acceptedFields?.fields.find((f) => f.name === field.name)
        : undefined) ?? field;

    // Merge global args with command args. A same-named field is rejected by
    // validation, so command args only win here when `skipValidation` is set.
    const mergedPlainArgs = mergeNestedArgs(
      { ...proxiedGlobalArgs },
      { ...proxiedCommandArgs },
      options._globalExtracted?.fields ?? [],
      parseResult.extractedFields?.fields ?? [],
    );
    const argSourceMap = new Map<string, ArgSource>(globalSourceMap);
    const localEnvFallbackFields = parseResult.envFallbackFields ?? new Set<string>();
    // Classify every declared local field explicitly (not just ones present in
    // rawArgs) so a local field resolved via schema default/prompt correctly
    // overrides a same-named global field's "cli"/"env" classification instead
    // of leaking it through unchanged (reachable only with `skipValidation`).
    for (const field of parseResult.extractedFields?.fields ?? []) {
      // A resolver may have deleted the parser's value, leaving the schema
      // default to fill it in.
      const parserValueKept = argsToValidate[field.name] !== undefined;
      argSourceMap.set(
        field.name,
        promptResolvedFields.has(field.name)
          ? "prompt"
          : parserValueKept && localEnvFallbackFields.has(field.name)
            ? "env"
            : parserValueKept && hasParserValue(field.name)
              ? "cli"
              : "default",
      );
    }
    attachArgSource(mergedPlainArgs, argSourceMap);
    attachInvocation(mergedPlainArgs, resolveInvocation(command, context));
    attachAgent(mergedPlainArgs, options._agent);
    const mergedArgs = createDualCaseProxy(mergedPlainArgs);

    // Run the command
    // Stop this collector and pass logs to executeLifecycle
    collector?.stop();
    const result = await executeLifecycle(command, mergedArgs, {
      handleSignals: options.handleSignals,
      captureLogs: options.captureLogs,
      existingLogs: getCurrentLogs(),
      globalCleanup: options._globalCleanup,
      packageDiscriminators: [
        parseResult.extractedFields?.discriminator,
        options._globalExtracted?.discriminator,
      ].filter((name): name is string => name !== undefined),
      packageFields: isCompletionInvocation
        ? undefined
        : [
            ...(options._globalExtracted
              ? selectDiscriminatedVariant(options._globalExtracted, () => validatedGlobalArgs)
                  .fields
              : []),
            ...(parseResult.optionFields ?? []).map(acceptedField),
            ...(parseResult.positionalSlotFields ?? []).map(acceptedField),
          ],
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
    validateReservedFieldNames(extracted);
    const positionalNames = extracted.fields.filter((f) => f.positional).map((f) => f.name);
    if (positionalNames.length > 0) {
      throw new Error(
        `Global options schema must not contain positional arguments. Found: ${positionalNames.join(", ")}`,
      );
    }
  }
  return extracted;
}
