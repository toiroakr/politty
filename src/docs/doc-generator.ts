import { extractFields, getExtractedFields } from "../core/schema-extractor.js";
import { resolveLazyCommand } from "../executor/subcommand-router.js";
import type { AnyCommand, ArgsSchema } from "../types.js";
import type { CommandInfo, RootCommandInfo, SubCommandInfo } from "./types.js";

/**
 * Options for buildCommandInfo
 */
export interface BuildCommandInfoOptions {
  /** Global arguments schema */
  globalArgs?: ArgsSchema | undefined;
  /** Root command info (only applied to root command) */
  rootInfo?: RootCommandInfo | undefined;
}

/**
 * Build CommandInfo from a command
 */
export async function buildCommandInfo(
  command: AnyCommand,
  rootName: string,
  commandPath: string[] = [],
  options: BuildCommandInfoOptions = {},
): Promise<CommandInfo> {
  const extracted = getExtractedFields(command);

  const positionalArgs = extracted?.fields.filter((f) => f.positional) ?? [];
  const cmdOptions = extracted?.fields.filter((f) => !f.positional) ?? [];

  const subCommands: SubCommandInfo[] = [];
  if (command.subCommands) {
    for (const [name, subCmd] of Object.entries(command.subCommands)) {
      const resolved = await resolveLazyCommand(subCmd);
      const fullPath = [...commandPath, name];
      subCommands.push({
        name,
        description: resolved.description,
        fullPath,
      });
    }
  }

  // Extract global options if provided
  const globalOptions = options.globalArgs
    ? extractFields(options.globalArgs)?.fields.filter((f) => !f.positional)
    : undefined;

  const isRoot = commandPath.length === 0;

  return {
    name: command.name ?? "",
    description: command.description,
    fullCommandPath: commandPath.length > 0 ? `${rootName} ${commandPath.join(" ")}` : rootName,
    commandPath: commandPath.join(" "),
    depth: commandPath.length + 1,
    positionalArgs,
    options: cmdOptions,
    subCommands,
    extracted,
    command,
    notes: command.notes,
    examples: command.examples,
    globalOptions,
    isRoot,
  };
}

/**
 * Options for collectAllCommands
 */
export interface CollectAllCommandsOptions {
  /** Global arguments schema */
  globalArgs?: ArgsSchema | undefined;
  /** Root command info */
  rootInfo?: RootCommandInfo | undefined;
}

/**
 * Collect all commands with their paths
 * Returns a map of command path -> CommandInfo
 */
export async function collectAllCommands(
  command: AnyCommand,
  rootName?: string,
  options: CollectAllCommandsOptions = {},
): Promise<Map<string, CommandInfo>> {
  const root = rootName ?? command.name ?? "command";
  const result = new Map<string, CommandInfo>();

  async function traverse(cmd: AnyCommand, path: string[]): Promise<void> {
    const info = await buildCommandInfo(cmd, root, path, {
      globalArgs: options.globalArgs,
      rootInfo: path.length === 0 ? options.rootInfo : undefined,
    });
    const pathKey = path.join(" ");
    result.set(pathKey, info);

    if (cmd.subCommands) {
      for (const [name, subCmd] of Object.entries(cmd.subCommands)) {
        const resolved = await resolveLazyCommand(subCmd);
        await traverse(resolved, [...path, name]);
      }
    }
  }

  await traverse(command, []);
  return result;
}
