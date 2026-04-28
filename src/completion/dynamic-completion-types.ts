/**
 * Public surface for dynamic completion types. The actual definitions live
 * under `core/` so `arg-registry.ts` can reference them without crossing
 * the lint-enforced `completion → core` boundary; this module re-exports
 * them and adds completion-internal helpers (e.g. type guards) that need
 * access to `ValueCompletion`.
 */

import type { ValueCompletion } from "./types.js";

export type {
  CompletionDirectiveMask,
  DynamicCompletionCandidate,
  DynamicCompletionContext,
  DynamicCompletionResolver,
  DynamicCompletionResult,
} from "../core/dynamic-completion-types.js";

/**
 * Type guard for the `dynamic` variant of `ValueCompletion`.
 */
export function isDynamicValueCompletion(
  vc: ValueCompletion | undefined,
): vc is Extract<ValueCompletion, { type: "dynamic" }> {
  return vc?.type === "dynamic";
}
