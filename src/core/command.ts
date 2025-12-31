import { z } from "zod";
import type { ArgsSchema, Command, NonRunnableCommand, RunnableCommand } from "../types.js";

/**
 * Infer args type from schema, defaults to empty object if undefined
 */
type InferArgs<TArgsSchema> = TArgsSchema extends z.ZodType
  ? z.infer<TArgsSchema>
  : Record<string, never>;

/**
 * Config for defining a command
 * @template TArgsSchema - The Zod schema type for arguments
 * @template TResult - The return type of run function (void if no run)
 */
interface DefineCommandConfig<TArgsSchema extends ArgsSchema | undefined, TResult> {
  name: string;
  description?: string;
  args?: TArgsSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  subCommands?: Record<string, Command<any, any, any> | (() => Promise<Command<any, any, any>>)>;
  setup?: (context: { args: InferArgs<TArgsSchema> }) => void | Promise<void>;
  run?: (args: InferArgs<TArgsSchema>) => TResult;
  cleanup?: (context: {
    args: InferArgs<TArgsSchema>;
    error?: Error | undefined;
  }) => void | Promise<void>;
  notes?: string;
}

/**
 * Config with run function (runnable command)
 */
interface RunnableConfig<
  TArgsSchema extends ArgsSchema | undefined,
  TResult,
> extends DefineCommandConfig<TArgsSchema, TResult> {
  run: (args: InferArgs<TArgsSchema>) => TResult;
}

/**
 * Config without run function (non-runnable command)
 */
interface NonRunnableConfig<TArgsSchema extends ArgsSchema | undefined> extends Omit<
  DefineCommandConfig<TArgsSchema, void>,
  "run"
> {
  run?: undefined;
}

/**
 * Define a CLI command with type-safe arguments
 *
 * @param config - Command configuration
 * @returns A defined command with preserved type information
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
 *
 * // Type of command.argsSchema is preserved as z.ZodObject<...>
 * // Type of command.run is (args: { name: string; loud: boolean }) => void
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
// Overload 1: with run function - returns RunnableCommand with preserved schema type
export function defineCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TResult = void,
>(
  config: RunnableConfig<TArgsSchema, TResult>,
): RunnableCommand<TArgsSchema, InferArgs<TArgsSchema>, TResult>;

// Overload 2: without run function - returns NonRunnableCommand with preserved schema type
export function defineCommand<TArgsSchema extends ArgsSchema | undefined = undefined>(
  config: NonRunnableConfig<TArgsSchema>,
): NonRunnableCommand<TArgsSchema, InferArgs<TArgsSchema>>;

// Implementation
export function defineCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TResult = void,
>(
  config: RunnableConfig<TArgsSchema, TResult> | NonRunnableConfig<TArgsSchema>,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  return {
    name: config.name,
    description: config.description,
    argsSchema: config.args as TArgsSchema,
    subCommands: config.subCommands,
    setup: config.setup,
    run: config.run,
    cleanup: config.cleanup,
    notes: config.notes,
  };
}
