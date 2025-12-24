import { z } from "zod";
import type { ArgsSchema, Command, CommandConfig } from "../types.js";

/**
 * Define a CLI command with type-safe arguments
 *
 * @param config - Command configuration
 * @returns A defined command
 *
 * @example
 * ```ts
 * import { z } from "zod";
 * import { arg, defineCommand } from "politty";
 *
 * const command = defineCommand({
 *   name: "greet",
 *   args: z.object({
 *     name: arg(z.string(), { description: "Name to greet", positional: true }),
 *     loud: arg(z.boolean().default(false), { alias: "l", description: "Use uppercase" }),
 *   }),
 *   run: ({ args }) => {
 *     const greeting = `Hello, ${args.name}!`;
 *     console.log(args.loud ? greeting.toUpperCase() : greeting);
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * // With discriminated union for subcommand-like behavior
 * const command = defineCommand({
 *   name: "resource",
 *   args: z.discriminatedUnion("action", [
 *     z.object({
 *       action: z.literal("create"),
 *       name: arg(z.string(), { description: "Resource name" }),
 *     }),
 *     z.object({
 *       action: z.literal("delete"),
 *       id: arg(z.coerce.number(), { description: "Resource ID" }),
 *     }),
 *   ]),
 *   run: ({ args }) => {
 *     if (args.action === "create") {
 *       console.log(`Creating ${args.name}`);
 *     } else {
 *       console.log(`Deleting ${args.id}`);
 *     }
 *   },
 * });
 * ```
 */
export function defineCommand<TArgsSchema extends ArgsSchema | undefined, TResult = void>(
  config: CommandConfig<TArgsSchema, TResult>,
): Command<TArgsSchema extends z.ZodType ? z.infer<TArgsSchema> : Record<string, never>, TResult> {
  type TArgs = TArgsSchema extends z.ZodType ? z.infer<TArgsSchema> : Record<string, never>;

  return {
    name: config.name,
    version: config.version,
    description: config.description,
    argsSchema: config.args as ArgsSchema | undefined,
    subCommands: config.subCommands,
    setup: config.setup as Command<TArgs, TResult>["setup"],
    run: config.run as Command<TArgs, TResult>["run"],
    cleanup: config.cleanup as Command<TArgs, TResult>["cleanup"],
  };
}
