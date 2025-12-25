import { z } from "zod";
import type {
  ArgsSchema,
  Command,
  CommandConfig,
  NonRunnableCommand,
  RunnableCommand,
} from "../types.js";

/**
 * Infer args type from schema
 */
type InferArgs<TArgsSchema> = TArgsSchema extends z.ZodType
  ? z.infer<TArgsSchema>
  : Record<string, never>;

/**
 * Config for runnable command (with run function)
 */
interface RunnableConfig<TArgsSchema extends ArgsSchema | undefined, TResult> {
  name: string;
  description?: string;
  args?: TArgsSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands?: Record<string, Command<any, any> | (() => Promise<Command<any, any>>)>;
  setup?: (context: { args: InferArgs<TArgsSchema> }) => void | Promise<void>;
  run: (args: InferArgs<TArgsSchema>) => TResult;
  cleanup?: (context: {
    args: InferArgs<TArgsSchema>;
    error?: Error | undefined;
  }) => void | Promise<void>;
}

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
 *   run: (args) => {
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
 *   run: (args) => {
 *     if (args.action === "create") {
 *       console.log(`Creating ${args.name}`);
 *     } else {
 *       console.log(`Deleting ${args.id}`);
 *     }
 *   },
 * });
 * ```
 */
// Overload 1: with run function
export function defineCommand<TArgsSchema extends ArgsSchema | undefined, TResult>(
  config: RunnableConfig<TArgsSchema, TResult>,
): RunnableCommand<InferArgs<TArgsSchema>, TResult>;

// Overload 2: without run function
export function defineCommand<TArgsSchema extends ArgsSchema | undefined>(
  config: Omit<CommandConfig<TArgsSchema, void>, "run">,
): NonRunnableCommand<InferArgs<TArgsSchema>>;

// Implementation
export function defineCommand<TArgsSchema extends ArgsSchema | undefined, TResult = void>(
  config: CommandConfig<TArgsSchema, TResult>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    name: config.name,
    description: config.description,
    argsSchema: config.args as ArgsSchema | undefined,
    subCommands: config.subCommands,
    setup: config.setup,
    run: config.run,
    cleanup: config.cleanup,
  };
}
