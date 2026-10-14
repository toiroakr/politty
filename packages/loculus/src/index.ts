import {
  arg as coreArg,
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  createCompileCacheShimGenerator,
  type ArgFn,
  type CreateDefineCommandFn,
  type DefineCommandFn,
} from "@politty/core";
import type { Field, Schema } from "loculus";
import "./register.js";
export * from "@politty/core";
export const generateCompileCacheShim = createCompileCacheShimGenerator("@politty/loculus");
export type ArgsSchema = Schema<Record<string, unknown>, Record<string, any>>;
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
export const arg: ArgFn<Field<any, any, boolean> & { readonly shape?: never }> = coreArg;
