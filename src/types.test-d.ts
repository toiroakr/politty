/**
 * Type tests for ArgsSchema and SupportedArgsObject types.
 * These tests verify that the generic constraints work correctly.
 *
 * Run with: pnpm typecheck
 */

import { z } from "zod";
import { defineCommand } from "./index.js";
import type { ArgsSchema, SupportedArgsObject } from "./types.js";

// ============================================================================
// Helper type for testing: checks if a type is assignable to ArgsSchema
// ============================================================================
type IsValidArgsSchema<T> = T extends ArgsSchema ? true : false;

// ============================================================================
// Tests for SUPPORTED schema types (should be assignable to ArgsSchema)
// ============================================================================

// Test: ZodObject is supported
{
  const schema = z.object({ name: z.string() });
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;

  // Verify it works with defineCommand
  defineCommand({
    name: "test",
    args: schema,
    run: (args) => {
      // args should be typed correctly
      void (args.name satisfies string);
    },
  });
}

// Test: ZodObject with optional fields
{
  const schema = z.object({
    required: z.string(),
    optional: z.string().optional(),
    withDefault: z.string().default("default"),
  });
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;
}

// Test: ZodDiscriminatedUnion is supported
{
  const schema = z.discriminatedUnion("type", [
    z.object({ type: z.literal("a"), valueA: z.string() }),
    z.object({ type: z.literal("b"), valueB: z.number() }),
  ]);
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;

  // Verify it works with defineCommand
  defineCommand({
    name: "test",
    args: schema,
    run: (args) => {
      if (args.type === "a") {
        void (args.valueA satisfies string);
      }
    },
  });
}

// Test: ZodUnion is supported
{
  const schema = z.union([
    z.object({ token: z.string() }),
    z.object({ username: z.string(), password: z.string() }),
  ]);
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;
}

// Test: ZodXor is supported
{
  const schema = z.xor([
    z.object({ token: z.string() }),
    z.object({ username: z.string(), password: z.string() }),
  ]);
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;
}

// Test: ZodIntersection is supported
{
  const baseSchema = z.object({ verbose: z.boolean().default(false) });
  const extendedSchema = z.object({ input: z.string() });
  const schema = baseSchema.and(extendedSchema);
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;

  // Verify it works with defineCommand
  defineCommand({
    name: "test",
    args: schema,
    run: (args) => {
      void (args.verbose satisfies boolean);
      void (args.input satisfies string);
    },
  });
}

// Test: strictObject is supported
{
  const schema = z.strictObject({ name: z.string() });
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;
}

// Test: looseObject is supported
{
  const schema = z.looseObject({ name: z.string() });
  type Test = IsValidArgsSchema<typeof schema>;
  const check: Test = true;
  void check;
}

// ============================================================================
// Tests for UNSUPPORTED schema types (should NOT be assignable to ArgsSchema)
// These use @ts-expect-error to verify the type constraints work correctly
// ============================================================================

// Test: z.string() is NOT supported (primitive, not an object-like schema)
{
  const schema = z.string();
  void schema;
  // @ts-expect-error - z.string() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.number() is NOT supported
{
  const schema = z.number();
  void schema;
  // @ts-expect-error - z.number() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.boolean() is NOT supported
{
  const schema = z.boolean();
  void schema;
  // @ts-expect-error - z.boolean() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.array() is NOT supported (arrays are not key-value pairs)
{
  const schema = z.array(z.string());
  void schema;
  // @ts-expect-error - z.array() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.tuple() is NOT supported
{
  const schema = z.tuple([z.string(), z.number()]);
  void schema;
  // @ts-expect-error - z.tuple() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.record() is NOT supported (dynamic keys are not suitable for CLI)
{
  const schema = z.record(z.string(), z.number());
  void schema;
  // @ts-expect-error - z.record() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.map() is NOT supported
{
  const schema = z.map(z.string(), z.number());
  void schema;
  // @ts-expect-error - z.map() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.set() is NOT supported
{
  const schema = z.set(z.string());
  void schema;
  // @ts-expect-error - z.set() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.enum() is NOT supported (enum alone is not an object schema)
{
  const schema = z.enum(["a", "b", "c"]);
  void schema;
  // @ts-expect-error - z.enum() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// Test: z.literal() is NOT supported
{
  const schema = z.literal("value");
  void schema;
  // @ts-expect-error - z.literal() should not be assignable to ArgsSchema
  const invalid: ArgsSchema = schema;
  void invalid;
}

// ============================================================================
// Test: SupportedArgsObject type is exported and usable
// ============================================================================
{
  // Verify type is exported and can be used
  type TestExport = SupportedArgsObject;
  void (undefined as unknown as TestExport);

  // Verify it matches ArgsSchema
  type TestMatch = ArgsSchema extends SupportedArgsObject
    ? SupportedArgsObject extends ArgsSchema
      ? true
      : false
    : false;
  const check: TestMatch = true;
  void check;
}
