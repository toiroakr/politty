import { isLazyCommand, resolveSubCommandMeta } from "../lazy.js";
import type { AnyCommand, SubCommandValue } from "../types.js";

interface Resolved {
  command: AnyCommand;
  meta?: AnyCommand;
}

function searchWithoutLoading(
  parent: AnyCommand,
  target: AnyCommand,
  visited: Set<AnyCommand>,
): string[] | undefined {
  for (const [name, value] of Object.entries(parent.subCommands ?? {})) {
    const command = resolveSubCommandMeta(value);
    if (!command) continue;
    if (command === target) return [name];
    if (visited.has(command)) continue;
    visited.add(command);
    const below = searchWithoutLoading(command, target, visited);
    if (below) return [name, ...below];
  }
  return undefined;
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

function namedLikeTarget(target: AnyCommand) {
  return ([name, value]: [string, SubCommandValue]): boolean =>
    name === target.name || resolveSubCommandMeta(value)?.name === target.name;
}

async function searchByLoading(
  parent: AnyCommand,
  target: AnyCommand,
  visited: Set<AnyCommand>,
): Promise<string[] | undefined> {
  const likely = namedLikeTarget(target);
  const entries = Object.entries(parent.subCommands ?? {}).sort(
    (a, b) => Number(likely(b)) - Number(likely(a)),
  );
  for (const [name, value] of entries) {
    const resolved = await resolve(value);
    if (!resolved) continue;
    if (resolved.command === target || resolved.meta === target) return [name];
    if (visited.has(resolved.command)) continue;
    visited.add(resolved.command);
    const below = await searchByLoading(resolved.command, target, visited);
    if (below) return [name, ...below];
  }
  return undefined;
}

/**
 * Find the registered subcommand keys that lead from `root` to `target`.
 * Commands that are declared in the tree, including the metadata of lazy
 * subcommands, are matched without loading anything; lazy and async
 * subcommands are loaded only when that finds nothing, starting with the ones
 * named like the target. An empty path means `target` is the root;
 * `undefined` means it is not in the tree.
 */
export async function findCommandPath(
  root: AnyCommand,
  target: AnyCommand,
): Promise<string[] | undefined> {
  if (root === target) return [];
  return (
    searchWithoutLoading(root, target, new Set([root])) ??
    (await searchByLoading(root, target, new Set([root])))
  );
}
