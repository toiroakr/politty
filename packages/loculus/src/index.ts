import {
  arg as coreArg,
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  createCompileCacheShimGenerator,
  type ArgFn,
  type CreateDefineCommandFn,
  type DefineCommandFn,
  type NestedKeyStyle,
} from "@politty/core";
import type { Field, ObjectSchema, Schema } from "loculus";
import "./register.js";
export * from "@politty/core";
export const generateCompileCacheShim = createCompileCacheShimGenerator("@politty/loculus");
export type ArgsSchema = Schema<Record<string, unknown>, Record<string, any>>;
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
/**
 * `arg()` for an object field, which expands into one option per property:
 * only `description` and the option naming style apply to the object itself.
 */
interface ObjectArgFn {
  <T extends ObjectSchema<any, any, any, boolean>>(
    schema: T,
    meta: { description?: string; flatten?: NestedKeyStyle },
  ): T;
}
export const arg: ArgFn<Field<any, any, boolean> & { readonly shape?: never }> & ObjectArgFn =
  coreArg;
