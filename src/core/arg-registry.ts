import { z } from "zod";

/**
 * Base metadata shared by all argument types
 */
export interface BaseArgMeta {
  /** Argument description */
  description?: string;
  /** Treat as positional argument */
  positional?: boolean;
  /** Placeholder for help display */
  placeholder?: string;
}

/**
 * Metadata for regular arguments (non-builtin aliases)
 */
export interface RegularArgMeta extends BaseArgMeta {
  /** Short alias (e.g., 'v' for --verbose) */
  alias?: string;
}

/**
 * Metadata for overriding built-in aliases (-h, -H)
 */
export interface BuiltinOverrideArgMeta extends BaseArgMeta {
  /** Built-in alias to override ('h' or 'H') */
  alias: "h" | "H";
  /** Must be true to override built-in aliases */
  overrideBuiltinAlias: true;
}

/**
 * Metadata options for argument definition
 */
export type ArgMeta = RegularArgMeta | BuiltinOverrideArgMeta;

/**
 * Custom registry for politty argument metadata
 * This avoids polluting Zod's GlobalMeta
 */
export const argRegistry = z.registry<ArgMeta>();

/**
 * Register metadata for a Zod schema
 *
 * @param schema - The Zod schema
 * @param meta - Argument metadata
 * @returns The same schema (for chaining)
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { arg, defineCommand } from "politty";
 *
 * const cmd = defineCommand({
 *   args: z.object({
 *     name: arg(z.string(), { description: "User name", positional: true }),
 *     verbose: arg(z.boolean().default(false), { alias: "v" }),
 *   }),
 *   run: (args) => {
 *     console.log(args.name, args.verbose);
 *   },
 * });
 * ```
 */
/**
 * Type helper to validate ArgMeta
 * Forces a type error if alias is "h" or "H" without overrideBuiltinAlias: true
 */
type ValidateArgMeta<M> = M extends { alias: "h" | "H" }
  ? M extends { overrideBuiltinAlias: true }
    ? M
    : {
        [K in keyof M]: M[K];
      } & {
        __typeError: "Alias 'h' or 'H' requires overrideBuiltinAlias: true";
      }
  : M;

export function arg<T extends z.ZodType, M extends ArgMeta>(
  schema: T,
  meta: ValidateArgMeta<M>,
): T {
  argRegistry.add(schema, meta as ArgMeta);
  return schema;
}

/**
 * Get metadata for a schema from the registry
 *
 * @param schema - The Zod schema
 * @returns The metadata if registered, undefined otherwise
 */
export function getArgMeta(schema: z.ZodType): ArgMeta | undefined {
  return argRegistry.get(schema);
}

/**
 * Check if a schema has metadata registered
 *
 * @param schema - The Zod schema
 * @returns true if metadata is registered
 */
export function hasArgMeta(schema: z.ZodType): boolean {
  return argRegistry.has(schema);
}
