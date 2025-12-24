import type { AnyCommand, MainOptions, RunResult } from "../types.js";
import { parseArgs } from "../parser/arg-parser.js";
import { validateArgs } from "../validator/zod-validator.js";
import {
  formatValidationErrors,
  formatUnknownFlag,
  formatUnknownSubcommand,
  formatRuntimeError,
} from "../validator/error-formatter.js";
import { generateHelp, type CommandContext } from "../output/help-generator.js";
import { runCommand } from "../executor/command-runner.js";
import { resolveSubcommand, listSubCommands } from "../executor/subcommand-router.js";

/**
 * Internal options for runMain (includes context tracking)
 */
interface InternalMainOptions extends MainOptions {
  /** Command hierarchy context (internal use) */
  _context?: CommandContext;
}

/**
 * Run a CLI command as the main entry point
 *
 * @param command - The command to run
 * @param options - Main options
 * @returns The result of command execution
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
 * runMain(command);
 * ```
 */
export async function runMain<TResult = unknown>(
  command: AnyCommand,
  options: MainOptions = {},
): Promise<RunResult<TResult>> {
  const internalOptions = options as InternalMainOptions;
  const argv = options.argv ?? process.argv.slice(2);

  // Check if this is the top-level call (not a recursive subcommand call)
  const isTopLevel = !internalOptions._context;

  // Check if we should auto-exit
  // Default: true when using process.argv (CLI mode), false when argv is provided (programmatic mode)
  const shouldAutoExit = isTopLevel && (options.exit ?? !options.argv);

  // Initialize or get existing context
  const context: CommandContext = internalOptions._context ?? {
    commandPath: [],
    rootName: command.name,
    rootVersion: command.version,
  };

  try {
    // Parse arguments
    const parseResult = parseArgs(argv, command);

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
      return exitWithCode({ exitCode: hasUnknownSubcommand ? 1 : 0 }, shouldAutoExit);
    }

    // Handle --version
    if (parseResult.versionRequested) {
      // For subcommands, show root version
      const version = context.rootVersion ?? command.version;
      if (version) {
        console.log(version);
      }
      return exitWithCode({ exitCode: 0 }, shouldAutoExit);
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
        const subResult = await runMain<TResult>(subCmd, {
          ...options,
          argv: parseResult.remainingArgs,
          _context: subContext,
        } as InternalMainOptions);
        // Exit with subcommand's exit code if at top level
        return exitWithCode(subResult, shouldAutoExit);
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
      return exitWithCode({ exitCode: 0 }, shouldAutoExit);
    }

    // Warn about unknown flags
    if (parseResult.unknownFlags.length > 0) {
      const knownFlags = parseResult.extractedFields?.fields.map((f) => f.name) ?? [];
      for (const flag of parseResult.unknownFlags) {
        console.error(formatUnknownFlag(flag, knownFlags));
      }
      return exitWithCode({ exitCode: 1 }, shouldAutoExit);
    }

    // Validate arguments
    if (!command.argsSchema) {
      // No schema, run with empty args
      const result = await runCommand(command, {} as Record<string, never>, argv, {
        debug: options.debug,
        handleSignals: options.handleSignals,
      });
      return exitWithCode(result as RunResult<TResult>, shouldAutoExit);
    }

    const validationResult = validateArgs(parseResult.rawArgs, command.argsSchema);

    if (!validationResult.success) {
      console.error(formatValidationErrors(validationResult.errors));
      return exitWithCode({ exitCode: 1 }, shouldAutoExit);
    }

    // Run the command
    const result = await runCommand(command, validationResult.data, argv, {
      debug: options.debug,
      handleSignals: options.handleSignals,
    });

    return exitWithCode(result as RunResult<TResult>, shouldAutoExit);
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    console.error(formatRuntimeError(err, options.debug ?? false));
    return exitWithCode({ exitCode: 1 }, shouldAutoExit);
  }
}

/**
 * Exit with the given result code if at top level
 */
function exitWithCode<TResult>(
  result: RunResult<TResult>,
  isTopLevel: boolean,
): RunResult<TResult> {
  if (isTopLevel && result.exitCode !== undefined) {
    process.exit(result.exitCode);
  }
  return result;
}
