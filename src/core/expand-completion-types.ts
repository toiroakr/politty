/**
 * Types for "expand" completion — candidates that are pre-enumerated at
 * script-generation time and inlined into the static shell script.
 *
 * The user provides `dependsOn` (sibling arg names that must have static
 * `choices` or an enum schema) and `enumerate(deps)`. politty walks the
 * cartesian product of the dependsOn values, calls `enumerate` for each
 * combination, and emits a case lookup keyed on the runtime values of those
 * args. No Node process is spawned on TAB.
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
 * `enumerate` runs once per cartesian-product combination at the time the
 * shell script is generated (e.g. when the user runs `<program> completion
 * zsh`). It must be a pure function of `deps`; politty does not retain it
 * for runtime use.
 */
export interface ExpandCompletion {
  dependsOn: readonly string[];
  enumerate: (deps: Readonly<Record<string, string>>) => ReadonlyArray<string | ExpandCandidate>;
}
