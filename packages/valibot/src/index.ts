/**
 * @politty/valibot - politty with valibot schemas
 *
 * The user-facing entry point for building politty CLIs with valibot:
 * installs the valibot validator adapter into `@politty/core` and
 * re-exports the core API, with the schema-taking functions re-pinned to
 * valibot's `GenericSchema` so a schema from another Standard Schema
 * library is rejected at the type level instead of failing at runtime in
 * the registered adapter.
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
import type { GenericSchema } from "valibot";

/**
 * Supported schema types for args in this package: valibot schemas whose
 * output is an object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArgsSchema = GenericSchema<unknown, Record<string, any>>;

// Re-pin the schema-taking API to valibot types (see module doc).
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
export const arg: ArgFn<GenericSchema<unknown, unknown>> = coreArg;
