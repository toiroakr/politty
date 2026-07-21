/**
 * Lazy-loaded subcommand with synchronous metadata
 */

import type { AnyCommand, SubCommandValue } from "./types.js";

/**
 * A lazily-loaded command that carries synchronous metadata for
 * static analysis (completion, help) while deferring full module
 * loading to execution time.
 */
export interface LazyCommand<T extends AnyCommand = AnyCommand> {
  readonly __politty_lazy__: true;
  readonly meta: T;
  readonly load: () => Promise<AnyCommand>;
}

/**
 * Type guard: check if a value is a LazyCommand
 */
export function isLazyCommand(value: unknown): value is LazyCommand {
  // Literal property access instead of a computed `LAZY_BRAND in value`
  // check: AOT compilers (perry) mishandle computed keys, and the literal
  // form is equivalent here.
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { __politty_lazy__?: unknown }).__politty_lazy__ === true
  );
}

/**
 * Create a lazily-loaded subcommand with synchronous metadata.
 *
 * The `meta` command provides names, descriptions, and args schema
 * for static analysis (completion scripts, help text) without loading
 * the full command module.
 *
 * The `load` function is called only at execution time.
 *
 * @example
 * ```ts
 * import { lazy, defineCommand } from "politty";
 *
 * const cli = defineCommand({
 *   name: "mycli",
 *   subCommands: {
 *     deploy: lazy(
 *       defineCommand({
 *         name: "deploy",
 *         description: "Deploy the application",
 *         args: z.object({ env: arg(z.string()) }),
 *       }),
 *       () => import("./deploy.js").then((m) => m.deployCommand),
 *     ),
 *   },
 * });
 * ```
 */
export function lazy<T extends AnyCommand>(
  meta: T,
  load: () => Promise<AnyCommand>,
): LazyCommand<T> {
  return {
    __politty_lazy__: true as const,
    meta,
    load,
  };
}

/**
 * Resolve synchronous metadata from a SubCommandValue.
 * Returns null for legacy async subcommands whose metadata is unavailable.
 */
export function resolveSubCommandMeta(subCmd: SubCommandValue): AnyCommand | null {
  if (isLazyCommand(subCmd)) return subCmd.meta;
  if (typeof subCmd === "function") return null;
  return subCmd;
}
