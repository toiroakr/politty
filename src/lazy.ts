/**
 * Lazy-loaded subcommand with synchronous metadata
 */

import type { AnyCommand } from "./types.js";

/**
 * Marker property for LazyCommand identification
 */
const LAZY_BRAND = "__politty_lazy__" as const;

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
  return (
    typeof value === "object" &&
    value !== null &&
    LAZY_BRAND in value &&
    (value as Record<string, unknown>)[LAZY_BRAND] === true
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
    [LAZY_BRAND]: true as const,
    meta,
    load,
  };
}
