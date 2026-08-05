/**
 * @politty/zod - politty with zod v4 schemas
 *
 * The user-facing entry point for building politty CLIs with zod: installs
 * the zod validator adapter into `@politty/core` and re-exports the core
 * API (whose public types are written against zod).
 *
 * @packageDocumentation
 */

import "./register.js";

export * from "@politty/core";

import {
  arg as coreArg,
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  type ArgFn,
  type CreateDefineCommandFn,
  type DefineCommandFn,
} from "@politty/core";
import type { z } from "zod";

/**
 * Supported schema types for args in this package: zod schemas whose
 * output is an object. Narrows `@politty/core`'s Standard-Schema-based
 * `ArgsSchema` back to politty's historical zod-typed public surface.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArgsSchema = z.ZodType<Record<string, any>>;

// Re-pin the schema-taking API to zod types. Core's functions accept any
// Standard Schema, but this package registers the zod adapter — a valibot
// (or other) schema would type-check and then fail at runtime, so reject it
// at the type level instead.
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
export const arg: ArgFn<z.ZodType> = coreArg;
