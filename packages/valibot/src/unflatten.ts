import {
  assertDeclaredKeys,
  pathResolver,
  registerUnflatten,
  unflattenRecord,
  type Unflatten,
  type UnflattenOptions,
} from "@politty/core/adapter/unflatten";
import * as v from "valibot";

type FlatObject = v.GenericSchema<unknown, Record<string, unknown>> & {
  readonly entries: v.ObjectEntries;
};

/**
 * Wrap a flat object schema so that its validated output is nested by the
 * dotted (or prefixed kebab-case / camelCase) keys. Option names, `arg()`
 * metadata and validation issue paths stay flat.
 *
 * @example
 * ```ts
 * const args = unflatten(
 *   v.object({
 *     "config.serverPort": arg(v.pipe(v.string(), v.transform(Number)), { alias: "p" }),
 *     "config.host": v.optional(v.string(), "localhost"),
 *   }),
 * );
 * // --config.serverPort 8080  →  { config: { serverPort: 8080, host: "localhost" } }
 * ```
 *
 * @throws TypeError when a key is both a value and a group (`db` and `db.host`)
 */
export function unflatten<S extends FlatObject>(
  schema: S,
): v.SchemaWithPipe<
  readonly [S, v.RawTransformAction<v.InferOutput<S>, Unflatten<v.InferOutput<S>>>]
>;
export function unflatten<S extends FlatObject, const O extends UnflattenOptions>(
  schema: S,
  options: O,
): v.SchemaWithPipe<
  readonly [S, v.RawTransformAction<v.InferOutput<S>, Unflatten<v.InferOutput<S>, O>>]
>;
export function unflatten(schema: FlatObject, options: UnflattenOptions = {}): unknown {
  const pathOf = pathResolver(options);
  assertDeclaredKeys(Object.keys(schema.entries), options);
  const nested = v.pipe(
    schema,
    v.rawTransform<Record<string, unknown>, unknown>(({ dataset, addIssue, NEVER }) => {
      const result = unflattenRecord(dataset.value, pathOf);
      if (!result.issues) return result.value;
      for (const issue of result.issues) {
        const key = issue.path[0]!;
        addIssue({
          message: issue.message,
          path: [{ type: "object", origin: "value", input: dataset.value, key, value: undefined }],
        });
      }
      return NEVER;
    }),
  );
  return registerUnflatten(nested, options);
}
