import { z } from "zod";

/**
 * Experiment: Simple define function with preserved type inference
 *
 * Goal: The return type should preserve:
 * - The exact args schema type
 * - The run function's argument type (inferred from args)
 * - The run function's return type
 */

// ============================================
// Version 1: Args is required
// ============================================

interface SimpleConfig<TArgsSchema extends z.ZodType, TResult> {
  args: TArgsSchema;
  run: (args: z.infer<TArgsSchema>) => TResult;
}

interface SimpleResult<TArgsSchema extends z.ZodType, TResult> {
  args: TArgsSchema;
  run: (args: z.infer<TArgsSchema>) => TResult;
}

export function defineSimple<TArgsSchema extends z.ZodType, TResult>(
  config: SimpleConfig<TArgsSchema, TResult>,
): SimpleResult<TArgsSchema, TResult> {
  return {
    args: config.args,
    run: config.run,
  };
}

// ============================================
// Version 2: With name property and optional args
// Using generics with defaults (no overloads)
// ============================================

// Default schema type for when args is not provided
type EmptySchema = z.ZodObject<Record<string, never>>;
const emptySchema: EmptySchema = z.object({});

// Config interface with optional args - using generics default
interface ConfigWithOptionalArgs<TArgsSchema extends z.ZodType = EmptySchema, TResult = void> {
  name: string;
  args?: TArgsSchema;
  run: (args: z.infer<TArgsSchema>) => TResult;
}

// Result type
interface ResultWithOptionalArgs<TArgsSchema extends z.ZodType = EmptySchema, TResult = void> {
  name: string;
  args: TArgsSchema;
  run: (args: z.infer<TArgsSchema>) => TResult;
}

export function defineWithOptionalArgs<TArgsSchema extends z.ZodType = EmptySchema, TResult = void>(
  config: ConfigWithOptionalArgs<TArgsSchema, TResult>,
): ResultWithOptionalArgs<TArgsSchema, TResult> {
  return {
    name: config.name,
    args: config.args ?? (emptySchema as unknown as TArgsSchema),
    run: config.run,
  };
}

// ============================================
// Test cases
// ============================================

// Mock arg function (same signature as the real one)
function arg<T extends z.ZodType>(schema: T, _meta: object): T {
  return schema;
}

// Test 1: Basic usage
const command1 = defineSimple({
  args: z.object({
    name: arg(z.string(), {}),
  }),
  run: (args) => {
    console.log(args);
    return args.name;
  },
});

// Test 2: With number return type
const command2 = defineSimple({
  args: z.object({
    count: z.number(),
    multiplier: z.number().default(1),
  }),
  run: (args) => {
    return args.count * args.multiplier;
  },
});

// Test 3: With void return type
const command3 = defineSimple({
  args: z.object({
    message: z.string(),
  }),
  run: (args) => {
    console.log(args.message);
  },
});

// Test 4: With Promise return type
const command4 = defineSimple({
  args: z.object({
    url: z.string(),
  }),
  run: async (args) => {
    return `Fetched: ${args.url}`;
  },
});

// ============================================
// Type verification (compile-time checks)
// ============================================

// These type assertions verify correct inference
// If types are wrong, these will cause compile errors

// Test 1: string return type
const test1Result = command1.run({ name: "test" });
console.log(test1Result);

// Test 2: number return type
const test2Result = command2.run({ count: 5, multiplier: 2 });
console.log(test2Result);

// Test 3: void return type
command3.run({ message: "hello" });

// Test 4: Promise<string> return type
const test4Result: Promise<string> = command4.run({
  url: "https://example.com",
});
console.log(test4Result);

// Schema type is preserved - can access via z.infer
type Inferred1 = z.infer<typeof command1.args>; // { name: string }
type Inferred2 = z.infer<typeof command2.args>; // { count: number; multiplier: number }

// Use the inferred types to prove they work
const _validArgs1: Inferred1 = { name: "hello" };
const _validArgs2: Inferred2 = { count: 1, multiplier: 2 };
console.log(_validArgs1, _validArgs2);

// ============================================
// Test cases for Version 2 (with name and optional args)
// ============================================

// Test 5: With args provided
const command5 = defineWithOptionalArgs({
  name: "sample",
  args: z.object({
    name: arg(z.string(), {}),
  }),
  run: (args) => {
    console.log(args);
    return args.name;
  },
});

// Verify type inference
const test5Name = command5.name;
const test5Result = command5.run({ name: "test" });
const test5Schema: z.infer<typeof command5.args> = { name: "hello" };
console.log(test5Name, test5Result, test5Schema);

// Test 6: Without args (uses default empty schema)
const command6 = defineWithOptionalArgs({
  name: "noargs",
  run: () => {
    return 42;
  },
});

const test6Name = command6.name;
const test6Result = command6.run({});
console.log(test6Name, test6Result);

// Verify command6.args is EmptySchema (empty object schema)
const _command6Schema: z.infer<typeof command6.args> = {};
console.log(_command6Schema);

// ============================================
// Test the actual defineCommand (after modification)
// ============================================
import { arg as realArg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";

// Test 7: defineCommand with args
const realCommand1 = defineCommand({
  name: "test",
  args: z.object({
    name: realArg(z.string(), { description: "Name" }),
    count: z.number().default(1),
  }),
  run: (args) => {
    return `Hello ${args.name} x${args.count}`;
  },
});

// Verify type inference for real command
const _rc1Name: string = realCommand1.name;
const _rc1Result: string = realCommand1.run({ name: "test", count: 5 });
// args preserves the original schema type
type RC1Schema = typeof realCommand1.args;
type RC1Inferred = z.infer<NonNullable<RC1Schema>>;
const _rc1Args: RC1Inferred = { name: "hello", count: 10 };
console.log(_rc1Name, _rc1Result, _rc1Args);

// Test 8: defineCommand without args
const realCommand2 = defineCommand({
  name: "noargs-test",
  run: () => {
    return 42;
  },
});

const _rc2Name: string = realCommand2.name;
const _rc2Result: number = realCommand2.run({});
// args is undefined when not provided in config
const _rc2Schema: undefined = realCommand2.args;
console.log(_rc2Name, _rc2Result, _rc2Schema);

// Test 9: defineCommand without run (non-runnable)
const realCommand3 = defineCommand({
  name: "parent",
  args: z.object({
    verbose: z.boolean().default(false),
  }),
});

const _rc3Name: string = realCommand3.name;
// run is undefined
const _rc3Run: undefined = realCommand3.run;
// args is preserved
type RC3Schema = typeof realCommand3.args;
type RC3Inferred = z.infer<NonNullable<RC3Schema>>;
const _rc3Args: RC3Inferred = { verbose: true };
console.log(_rc3Name, _rc3Run, _rc3Args);
