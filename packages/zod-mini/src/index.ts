/**
 * @politty/zod-mini - politty with zod/mini schemas
 *
 * The user-facing entry point for building politty CLIs with zod/mini:
 * installs the zod/mini validator adapter into `@politty/core` and
 * re-exports the core API, with the schema-taking functions re-pinned to
 * `zod/mini`'s `ZodMiniType` so a schema from another Standard Schema
 * library (including classic zod) is rejected at the type level instead of
 * failing at runtime in the registered adapter.
 *
 * @packageDocumentation
 */

import "./register.js";

export * from "@politty/core";

import {
  arg as coreArg,
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  createCompileCacheShimGenerator,
  type ArgFn,
  type CreateDefineCommandFn,
  type DefineCommandFn,
} from "@politty/core";
import type { z } from "zod/mini";

/**
 * Generate compile-cache bin shims that import the cache helper from
 * `@politty/zod-mini/compile-cache`.
 *
 * The specifier is this package's own name rather than something derived from
 * the caller's `package.json`: reaching this function means `@politty/zod-mini`
 * is installed, so the shim it writes into your package can resolve it.
 */
export const generateCompileCacheShim = createCompileCacheShimGenerator("@politty/zod-mini");

/**
 * Supported schema types for args in this package: zod/mini schemas whose
 * output is an object.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ArgsSchema = z.ZodMiniType<Record<string, any>>;

// Re-pin the schema-taking API to zod/mini types (see module doc).
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
export const arg: ArgFn<z.ZodMiniType> = coreArg;
