import {
  assertDeclaredKeys,
  pathResolver,
  registerUnflatten,
  unflattenRecord,
  type Unflatten,
  type UnflattenOptions,
} from "@politty/core/adapter/unflatten";
import * as z from "zod/mini";

/**
 * Wrap a flat object schema so that its validated output is nested by the
 * dotted (or prefixed kebab-case / camelCase) keys. Option names, `arg()`
 * metadata and validation issue paths stay flat.
 *
 * @example
 * ```ts
 * const args = unflatten(
 *   z.object({
 *     "config.serverPort": arg(z.coerce.number(), { alias: "p" }),
 *     "config.host": z._default(z.string(), "localhost"),
 *   }),
 * );
 * // --config.serverPort 8080  →  { config: { serverPort: 8080, host: "localhost" } }
 * ```
 *
 * @throws TypeError when a key is both a value and a group (`db` and `db.host`)
 */
export function unflatten<S extends z.ZodMiniObject>(
  schema: S,
): z.ZodMiniPipe<S, z.ZodMiniTransform<Unflatten<z.output<S>>, z.output<S>>>;
export function unflatten<S extends z.ZodMiniObject, const O extends UnflattenOptions>(
  schema: S,
  options: O,
): z.ZodMiniPipe<S, z.ZodMiniTransform<Unflatten<z.output<S>, O>, z.output<S>>>;
export function unflatten(schema: z.ZodMiniObject, options: UnflattenOptions = {}): z.ZodMiniType {
  const pathOf = pathResolver(options);
  assertDeclaredKeys(Object.keys(schema.shape), options);
  const nested = z.pipe(
    schema,
    z.transform((value: Record<string, unknown>, context) => {
      const result = unflattenRecord(value, pathOf);
      if (!result.issues) return result.value;
      for (const issue of result.issues) {
        context.issues.push({
          code: "custom",
          input: value,
          message: issue.message,
          path: issue.path,
        });
      }
      return z.NEVER;
    }),
  );
  return registerUnflatten(nested, options);
}
