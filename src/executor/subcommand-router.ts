import { isLazyCommand, resolveSubCommandMeta } from "../lazy.js";
import type { AnyCommand, SubCommandValue } from "../types.js";

/**
 * Resolve a lazy-loaded command (sync or async)
 *
 * @param cmd - The command or lazy loader function
 * @returns The resolved command
 */
export async function resolveLazyCommand(cmd: SubCommandValue): Promise<AnyCommand> {
  if (isLazyCommand(cmd)) {
    return await cmd.load();
  }
  if (typeof cmd === "function") {
    return await cmd();
  }
  return cmd;
}

/**
 * Resolve a subcommand by name (including alias lookup)
 *
 * Handles both sync and async (lazy-loaded) subcommands.
 * If the name does not match a direct subcommand key, searches
 * for a subcommand whose `aliases` array includes the name.
 *
 * @param command - The parent command
 * @param name - The subcommand name or alias to resolve
 * @returns The resolved subcommand, or undefined if not found
 */
export async function resolveSubcommand(
  command: AnyCommand,
  name: string,
): Promise<AnyCommand | undefined> {
  if (!command.subCommands) {
    return undefined;
  }

  // Direct lookup first
  const subCmd = command.subCommands[name];
  if (subCmd) {
    return resolveLazyCommand(subCmd);
  }

  // Alias lookup: find a subcommand whose aliases include the name
  const canonicalName = resolveSubCommandAlias(command, name);
  if (canonicalName) {
    return resolveLazyCommand(command.subCommands[canonicalName]!);
  }

  return undefined;
}

/**
 * Resolve an alias to the canonical subcommand name.
 * Returns the canonical name if the given name is an alias, or undefined.
 *
 * @param command - The parent command
 * @param alias - The alias to look up
 * @returns The canonical subcommand name, or undefined
 */
export function resolveSubCommandAlias(command: AnyCommand, alias: string): string | undefined {
  if (!command.subCommands) return undefined;

  for (const [name, subCmd] of Object.entries(command.subCommands)) {
    const meta = resolveSubCommandMeta(subCmd);
    if (meta?.aliases?.includes(alias)) {
      return name;
    }
  }
  return undefined;
}

/**
 * Build a set of all recognized subcommand names including aliases.
 *
 * @param command - The parent command
 * @returns Set of all names (canonical + aliases)
 */
export function listSubCommandNamesWithAliases(command: AnyCommand): Set<string> {
  const names = new Set<string>();
  if (!command.subCommands) return names;

  for (const [name, subCmd] of Object.entries(command.subCommands)) {
    names.add(name);
    const meta = resolveSubCommandMeta(subCmd);
    if (meta?.aliases) {
      for (const alias of meta.aliases) {
        names.add(alias);
      }
    }
  }
  return names;
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
