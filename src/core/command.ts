import type { z } from "zod";
import type {
  ArgsSchema,
  Command,
  Example,
  GlobalArgs,
  IsEmpty,
  NonRunnableCommand,
  RunnableCommand,
  SubCommandsRecord,
} from "../types.js";
import type { WithCaseVariants } from "./case-types.js";

/**
 * Infer args type from schema, defaults to empty object if undefined.
 * Wraps with WithCaseVariants so both camelCase and kebab-case access is typed.
 */
type InferArgs<TArgsSchema> = TArgsSchema extends z.ZodType
  ? WithCaseVariants<z.infer<TArgsSchema>>
  : Record<string, never>;

/**
 * Merge local args with global args.
 * No-op when TGlobalArgs is empty (default GlobalArgs not extended).
 * Wraps TGlobalArgs with WithCaseVariants for dual-case access.
 */
export type MergedArgs<TLocalArgs, TGlobalArgs> =
  IsEmpty<TGlobalArgs> extends true ? TLocalArgs : TLocalArgs & WithCaseVariants<TGlobalArgs>;

/**
 * Resolve merged args from schema and global args type
 */
type ResolvedArgs<TArgsSchema, TGlobalArgs> = MergedArgs<InferArgs<TArgsSchema>, TGlobalArgs>;

/**
 * Config for defining a command
 * @template TArgsSchema - The Zod schema type for arguments
 * @template TResult - The return type of run function (void if no run)
 * @template TGlobalArgs - Global args type (from declaration merging or factory)
 */
interface DefineCommandConfig<TArgsSchema extends ArgsSchema | undefined, TResult, TGlobalArgs> {
  name: string;
  description?: string;
  aliases?: string[];
  args?: TArgsSchema;
  subCommands?: SubCommandsRecord;
  setup?: (context: { args: ResolvedArgs<TArgsSchema, TGlobalArgs> }) => void | Promise<void>;
  run?: (args: ResolvedArgs<TArgsSchema, TGlobalArgs>) => TResult;
  cleanup?: (context: {
    args: ResolvedArgs<TArgsSchema, TGlobalArgs>;
    error?: Error | undefined;
  }) => void | Promise<void>;
  notes?: string;
  examples?: Example[];
}

/**
 * Config with run function (runnable command)
 */
export interface RunnableConfig<
  TArgsSchema extends ArgsSchema | undefined,
  TResult,
  TGlobalArgs,
> extends DefineCommandConfig<TArgsSchema, TResult, TGlobalArgs> {
  run: (args: ResolvedArgs<TArgsSchema, TGlobalArgs>) => TResult;
}

/**
 * Config without run function (non-runnable command)
 */
export interface NonRunnableConfig<
  TArgsSchema extends ArgsSchema | undefined,
  TGlobalArgs,
> extends Omit<DefineCommandConfig<TArgsSchema, void, TGlobalArgs>, "run"> {
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
  TGlobalArgs = GlobalArgs,
>(
  config: RunnableConfig<TArgsSchema, TResult, TGlobalArgs>,
): RunnableCommand<TArgsSchema, ResolvedArgs<TArgsSchema, TGlobalArgs>, TResult>;

// Overload 2: without run function - returns NonRunnableCommand with preserved schema type
export function defineCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TGlobalArgs = GlobalArgs,
>(
  config: NonRunnableConfig<TArgsSchema, TGlobalArgs>,
): NonRunnableCommand<TArgsSchema, ResolvedArgs<TArgsSchema, TGlobalArgs>>;

// Implementation
export function defineCommand<
  TArgsSchema extends ArgsSchema | undefined = undefined,
  TResult = void,
  TGlobalArgs = GlobalArgs,
>(
  config:
    | RunnableConfig<TArgsSchema, TResult, TGlobalArgs>
    | NonRunnableConfig<TArgsSchema, TGlobalArgs>,
): Command<TArgsSchema, ResolvedArgs<TArgsSchema, TGlobalArgs>, TResult> {
  return {
    name: config.name,
    description: config.description,
    aliases: config.aliases,
    args: config.args as TArgsSchema,
    subCommands: config.subCommands,
    setup: config.setup,
    run: config.run,
    cleanup: config.cleanup,
    notes: config.notes,
    examples: config.examples,
  } as Command<TArgsSchema, ResolvedArgs<TArgsSchema, TGlobalArgs>, TResult>;
}

/**
 * Create a typed defineCommand factory with pre-bound global args type.
 * This is the recommended pattern for type-safe global options.
 *
 * @example
 * ```ts
 * // global-args.ts
 * type GlobalArgsType = { verbose: boolean; config?: string };
 * export const defineAppCommand = createDefineCommand<GlobalArgsType>();
 *
 * // commands/build.ts
 * export const buildCommand = defineAppCommand({
 *   name: "build",
 *   args: z.object({ output: arg(z.string().default("dist")) }),
 *   run: (args) => {
 *     args.verbose; // typed via GlobalArgsType
 *     args.output;  // typed via local args
 *   },
 * });
 * ```
 */
export function createDefineCommand<TGlobalArgs>(): {
  <TArgsSchema extends ArgsSchema | undefined = undefined, TResult = void>(
    config: RunnableConfig<TArgsSchema, TResult, TGlobalArgs>,
  ): RunnableCommand<TArgsSchema, ResolvedArgs<TArgsSchema, TGlobalArgs>, TResult>;
  <TArgsSchema extends ArgsSchema | undefined = undefined>(
    config: NonRunnableConfig<TArgsSchema, TGlobalArgs>,
  ): NonRunnableCommand<TArgsSchema, ResolvedArgs<TArgsSchema, TGlobalArgs>>;
} {
  return defineCommand as ReturnType<typeof createDefineCommand<TGlobalArgs>>;
}
