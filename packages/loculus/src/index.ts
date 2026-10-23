import {
  arg as coreArg,
  createDefineCommand as coreCreateDefineCommand,
  defineCommand as coreDefineCommand,
  createCompileCacheShimGenerator,
  type ArgFn,
  type CreateDefineCommandFn,
  type DefineCommandFn,
} from "@politty/core";
import {
  assertDeclaredKeys,
  registerUnflatten,
  type UnflattenOptions,
} from "@politty/core/adapter/unflatten";
import { unflatten as loculusUnflatten, type Field, type Schema } from "loculus";
import "./register.js";
export * from "@politty/core";
export const generateCompileCacheShim = createCompileCacheShimGenerator("@politty/loculus");
export type ArgsSchema = Schema<Record<string, unknown>, Record<string, any>>;
export const defineCommand: DefineCommandFn<ArgsSchema> = coreDefineCommand;
export const createDefineCommand: CreateDefineCommandFn<ArgsSchema> = coreCreateDefineCommand;
export const arg: ArgFn<Field<any, any, boolean> & { readonly shape?: never }> = coreArg;

/**
 * loculus's `unflatten`, additionally recorded so that `effect` and
 * `requiredPackages` find a flat field's value in the nested output. The
 * style and prefixes cannot be read back from the wrapped schema, which is
 * why an `unflatten` imported from `loculus` itself is not enough.
 */
export const unflatten: typeof loculusUnflatten = ((
  schema: { meta: { shape?: Record<string, unknown> } },
  options?: UnflattenOptions,
) => {
  if (schema.meta.shape) assertDeclaredKeys(Object.keys(schema.meta.shape), options);
  return registerUnflatten(loculusUnflatten(schema as never, options as never), options ?? {});
}) as never;
