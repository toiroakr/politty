import { isLazyCommand } from "../lazy.js";
import type { AnyCommand, SubCommandValue } from "../types.js";

interface Resolved {
  command: AnyCommand;
  meta?: AnyCommand;
}

async function resolve(value: SubCommandValue): Promise<Resolved | undefined> {
  if (isLazyCommand(value)) {
    try {
      return { command: await value.load(), meta: value.meta };
    } catch {
      return { command: value.meta };
    }
  }
  if (typeof value === "function") {
    try {
      return { command: await value() };
    } catch {
      return undefined;
    }
  }
  return { command: value };
}

async function search(
  parent: AnyCommand,
  target: AnyCommand,
  visited: Set<AnyCommand>,
): Promise<string[] | undefined> {
  for (const [name, value] of Object.entries(parent.subCommands ?? {})) {
    const resolved = await resolve(value);
    if (!resolved) continue;
    if (resolved.command === target || resolved.meta === target) return [name];
    if (visited.has(resolved.command)) continue;
    visited.add(resolved.command);
    const below = await search(resolved.command, target, visited);
    if (below) return [name, ...below];
  }
  return undefined;
}

/**
 * Find the registered subcommand keys that lead from `root` to `target`,
 * loading lazy subcommands on the way. An empty path means `target` is the
 * root; `undefined` means it is not in the tree.
 */
export async function findCommandPath(
  root: AnyCommand,
  target: AnyCommand,
): Promise<string[] | undefined> {
  if (root === target) return [];
  return search(root, target, new Set([root]));
}
