import {
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  type CreateDefineCommandFn,
  type DefineCommandFn,
} from "@politty/core";
import { registerValidatorAdapter } from "@politty/core/adapter/registry";
import { standardAdapter, type StandardArgsSchema } from "./standard-adapter.js";

registerValidatorAdapter(standardAdapter);

export {
  extractFields,
  generateHelp,
  generateHelpData,
  getUnknownKeysMode,
  lazy,
  loadPackage,
  runCommand,
  runMain,
  withCompletionCommand,
  type AnyCommand,
  type ArgMeta,
  type InferSchemaOutput,
} from "@politty/core";

export {
  standardArgs,
  type StandardArgsOptions,
  type StandardArgsSchema,
  type StandardJSONSchema,
} from "./standard-adapter.js";

export type ArgsSchema = StandardArgsSchema;
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
