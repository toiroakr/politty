import {
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  createCompileCacheShimGenerator,
  type CreateDefineCommandFn,
  type DefineCommandFn,
} from "@politty/core";
import { registerValidatorAdapter } from "@politty/core/adapter/registry";
import { standardAdapter, type StandardArgsSchema } from "./standard-adapter.js";

registerValidatorAdapter(standardAdapter);

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
} from "./standard-adapter.js";

export type ArgsSchema = StandardArgsSchema;
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
export const generateCompileCacheShim = createCompileCacheShimGenerator("politty/standard");
