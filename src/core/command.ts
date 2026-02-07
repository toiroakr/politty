import { z } from "zod";
import type {
  ArgsSchema,
  Command,
  Example,
  NonRunnableCommand,
  RunnableCommand,
  SubCommandsRecord,
} from "../types.js";

import type { GlobalArgs } from "../types.js";

/**
 * Infer args type from schema, defaults to empty object if undefined
 */
type InferArgs<TArgsSchema> = TArgsSchema extends z.ZodType
  ? z.infer<TArgsSchema>
  : Record<string, never>;

/**
 * Merge command args with global args
 * If TGlobalArgs is empty ({}), just return TArgs
 */
type MergedArgs<TArgs, TGlobalArgs> = keyof TGlobalArgs extends never ? TArgs : TArgs & TGlobalArgs;

/**
 * Config for defining a command
 * @template TArgsSchema - The Zod schema type for arguments
 * @template TResult - The return type of run function (void if no run)
 * @template TGlobalArgs - The global args type (defaults to GlobalArgs interface)
 */
interface DefineCommandConfig<TArgsSchema extends ArgsSchema | undefined, TResult, TGlobalArgs> {
  name: string;
  description?: string;
  args?: TArgsSchema;
  subCommands?: SubCommandsRecord;
  setup?: (context: {
    args: MergedArgs<InferArgs<TArgsSchema>, TGlobalArgs>;
  }) => void | Promise<void>;
  run?: (args: MergedArgs<InferArgs<TArgsSchema>, TGlobalArgs>) => TResult;
  cleanup?: (context: {
    args: MergedArgs<InferArgs<TArgsSchema>, TGlobalArgs>;
    error?: Error | undefined;
  }) => void | Promise<void>;
  notes?: string;
  examples?: Example[];
}

/**
 * Config with run function (runnable command)
 */
interface RunnableConfig<
  TArgsSchema extends ArgsSchema | undefined,
  TResult,
  TGlobalArgs,
> extends DefineCommandConfig<TArgsSchema, TResult, TGlobalArgs> {
  run: (args: MergedArgs<InferArgs<TArgsSchema>, TGlobalArgs>) => TResult;
}

/**
 * Config without run function (non-runnable command)
 */
interface NonRunnableConfig<TArgsSchema extends ArgsSchema | undefined, TGlobalArgs> extends Omit<
  DefineCommandConfig<TArgsSchema, void, TGlobalArgs>,
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
// TGlobalArgs defaults to GlobalArgs interface (for declaration merging compatibility)
export function defineCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TResult = void,
  TGlobalArgs = GlobalArgs,
>(
  config: RunnableConfig<TArgsSchema, TResult, TGlobalArgs>,
): RunnableCommand<TArgsSchema, InferArgs<TArgsSchema>, TResult>;

// Overload 2: without run function - returns NonRunnableCommand with preserved schema type
export function defineCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TGlobalArgs = GlobalArgs,
>(
  config: NonRunnableConfig<TArgsSchema, TGlobalArgs>,
): NonRunnableCommand<TArgsSchema, InferArgs<TArgsSchema>>;

// Implementation
export function defineCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TResult = void,
  TGlobalArgs = GlobalArgs,
>(
  config:
    | RunnableConfig<TArgsSchema, TResult, TGlobalArgs>
    | NonRunnableConfig<TArgsSchema, TGlobalArgs>,
): Command<TArgsSchema, InferArgs<TArgsSchema>, TResult> {
  return {
    name: config.name,
    description: config.description,
    args: config.args as TArgsSchema,
    subCommands: config.subCommands,
    setup: config.setup,
    run: config.run,
    cleanup: config.cleanup,
    notes: config.notes,
    examples: config.examples,
  } as Command<TArgsSchema, InferArgs<TArgsSchema>, TResult>;
}
