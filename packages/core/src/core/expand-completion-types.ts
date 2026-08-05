/**
 * Types for "expand" completion — candidates that depend on sibling arg
 * values.
 *
 * The user provides `dependsOn` (sibling arg names that must have static
 * `choices` or an enum schema) and `enumerate(deps)`. Dispatcher scripts call
 * `enumerate` inside `__complete` for the dependency values already typed on
 * the command line. Static scripts walk the cartesian product of the
 * dependsOn values, call `enumerate` for each combination, and emit a shell
 * lookup table.
 *
 * Defined under `core/` (not `completion/`) so `arg-registry.ts` can
 * reference these types without crossing the lint-enforced
 * `completion → core` boundary.
 */

/** Candidate returned by an `enumerate` callback. */
export interface ExpandCandidate {
  value: string;
  description?: string;
}

/** Resolved candidate stored on a {@link ValueCompletion} after enumeration. */
export interface ResolvedExpandCandidate {
  value: string;
  description?: string;
}

/**
 * User-facing spec attached to `completion.custom.expand`.
 *
 * `dependsOn` lists sibling args (camelCase names) whose values determine
 * which candidates apply. Each named arg must have a static set of values —
 * either an explicit `completion.custom.choices` or an enum schema. The
 * order of `dependsOn` is the order in which `deps` keys are exposed to
 * `enumerate`.
 *
 * In dispatcher mode, `enumerate` runs during `__complete` for the dependency
 * values already typed by the user. In static mode, it runs once per
 * cartesian-product combination at script-generation time (e.g. when the user
 * runs `<program> completion zsh --static`). It must be a pure function of
 * `deps`.
 */
export interface ExpandCompletion {
  dependsOn: readonly string[];
  enumerate: (deps: Readonly<Record<string, string>>) => ReadonlyArray<string | ExpandCandidate>;
}
