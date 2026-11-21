import {
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  createCompileCacheShimGenerator,
  type CreateDefineCommandFn,
  type DefineCommandFn,
} from "@politty/core";
import type { StandardArgsSchema } from "./adapter.js";
import "./register.js";

export * from "@politty/core";

export {
  standardArgs,
  standardField,
  unflatten,
  type StandardArgsOptions,
  type StandardArgsSchema,
  type StandardDiscriminator,
  type StandardFieldMetadata,
  type StandardJSONSchema,
} from "./adapter.js";

export type ArgsSchema = StandardArgsSchema;
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
export const generateCompileCacheShim = createCompileCacheShimGenerator("@politty/standard");
