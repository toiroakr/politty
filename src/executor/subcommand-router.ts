import type { AnyCommand } from "../types.js";

/**
 * Resolve a subcommand by name
 *
 * Handles both sync and async (lazy-loaded) subcommands.
 *
 * @param command - The parent command
 * @param name - The subcommand name to resolve
 * @returns The resolved subcommand, or undefined if not found
 */
export async function resolveSubcommand(
  command: AnyCommand,
  name: string,
): Promise<AnyCommand | undefined> {
  if (!command.subCommands) {
    return undefined;
  }

  const subCmd = command.subCommands[name];

  if (!subCmd) {
    return undefined;
  }

  // Handle lazy-loaded (async) subcommands
  if (typeof subCmd === "function") {
    return await subCmd();
  }

  return subCmd;
}

/**
 * List all subcommand names for a command
 *
 * @param command - The parent command
 * @returns Array of subcommand names
 */
export function listSubCommands(command: AnyCommand): string[] {
  if (!command.subCommands) {
    return [];
  }

  return Object.keys(command.subCommands);
}
