/**
 * Type-level subset of the Standard Schema V1 interface
 * (https://standardschema.dev), vendored so `@politty/core` can constrain
 * and infer user schemas without importing any schema library.
 *
 * Both zod v4 and valibot v1 type their schemas against the official
 * `@standard-schema/spec` interface, so any schema from either library is
 * structurally assignable to {@link SchemaLike}. Only the properties core
 * needs for constraints and output inference are declared here — extra
 * properties on the real `~standard` object don't affect assignability.
 *
 * This is a TYPE-ONLY neutrality layer: core never calls
 * `~standard.validate` (rich validation goes through the registered
 * `ValidatorAdapter` so error output keeps library-specific detail).
 */

/** The `~standard` properties politty relies on. */
export interface StandardSchemaProps<Output = unknown> {
  /** Version of the Standard Schema spec the library implements */
  readonly version: 1;
  /** Name of the implementing library (e.g. "zod", "valibot") */
  readonly vendor: string;
  /** Standard validation entry point (unused by politty; see module doc) */
  readonly validate: (value: unknown) => unknown;
  /** Type-inference carrier (never exists at runtime) */
  readonly types?: { readonly output: Output } | undefined;
}

/**
 * A schema from any Standard Schema implementing library, constrained by
 * its output type.
 *
 * A primitive cannot satisfy this (it has no `~standard` property), which is
 * what matters in practice: schemas are used as `WeakMap` keys by the
 * `arg()` metadata registry. Intersecting with `object` would not add
 * safety — TypeScript still accepts a hand-written `string & SchemaLike<…>`
 * against an object-constrained type, and such a value throws
 * `Invalid value used as weak map key` the moment `arg()` registers it.
 */
export interface SchemaLike<Output = unknown> {
  readonly "~standard": StandardSchemaProps<Output>;
}

/** Infer the output type of a {@link SchemaLike}. */
export type InferSchemaOutput<S> = S extends SchemaLike
  ? NonNullable<S["~standard"]["types"]>["output"]
  : never;
