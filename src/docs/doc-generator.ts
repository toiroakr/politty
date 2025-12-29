import { extractFields, type ExtractedFields } from "../core/schema-extractor.js";
import type { AnyCommand } from "../types.js";
import type { CommandInfo, SubCommandInfo } from "./types.js";

/**
 * Resolve lazy-loaded subcommand
 */
export async function resolveSubcommand(
  subCmd: AnyCommand | (() => Promise<AnyCommand>),
): Promise<AnyCommand> {
  if (typeof subCmd === "function") {
    return await subCmd();
  }
  return subCmd;
}

/**
 * Build CommandInfo from a command
 */
export async function buildCommandInfo(
  command: AnyCommand,
  rootName: string,
  commandPath: string[] = [],
): Promise<CommandInfo> {
  const extracted = command.argsSchema ? extractFields(command.argsSchema) : null;

  const positionalArgs = extracted?.fields.filter((f) => f.positional) ?? [];
  const options = extracted?.fields.filter((f) => !f.positional) ?? [];

  const subCommands: SubCommandInfo[] = [];
  if (command.subCommands) {
    for (const [name, subCmd] of Object.entries(command.subCommands)) {
      const resolved = await resolveSubcommand(subCmd);
      const fullPath = [...commandPath, name];
      subCommands.push({
        name,
        description: resolved.description,
        relativePath: [name],
        fullPath,
      });
    }
  }

  return {
    name: command.name ?? "",
    description: command.description,
    fullCommandPath: commandPath.length > 0 ? `${rootName} ${commandPath.join(" ")}` : rootName,
    commandPath,
    rootName,
    positionalArgs,
    options,
    subCommands,
    extracted,
    command,
  };
}

/**
 * Collect all commands with their paths
 * Returns a map of command path -> CommandInfo
 */
export async function collectAllCommands(
  command: AnyCommand,
  rootName?: string,
): Promise<Map<string, CommandInfo>> {
  const root = rootName ?? command.name ?? "command";
  const result = new Map<string, CommandInfo>();

  async function traverse(cmd: AnyCommand, path: string[]): Promise<void> {
    const info = await buildCommandInfo(cmd, root, path);
    const pathKey = path.join(" ");
    result.set(pathKey, info);

    if (cmd.subCommands) {
      for (const [name, subCmd] of Object.entries(cmd.subCommands)) {
        const resolved = await resolveSubcommand(subCmd);
        await traverse(resolved, [...path, name]);
      }
    }
  }

  await traverse(command, []);
  return result;
}

/**
 * Get extracted fields from command
 */
export function getExtractedFields(command: AnyCommand): ExtractedFields | null {
  if (!command.argsSchema) {
    return null;
  }
  return extractFields(command.argsSchema);
}
