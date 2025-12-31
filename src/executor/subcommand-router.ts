import type { AnyCommand } from "../types.js";

/**
 * Resolve a lazy-loaded command (sync or async)
 *
 * @param cmd - The command or lazy loader function
 * @returns The resolved command
 */
export async function resolveLazyCommand(
  cmd: AnyCommand | (() => Promise<AnyCommand>),
): Promise<AnyCommand> {
  if (typeof cmd === "function") {
    return await cmd();
  }
  return cmd;
}

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

  return resolveLazyCommand(subCmd);
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
