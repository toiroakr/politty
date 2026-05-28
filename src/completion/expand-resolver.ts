/**
 * Resolve `completion.custom.expand` specs at script-generation time.
 *
 * The user-facing API records `dependsOn` (sibling arg names) plus an
 * `enumerate(deps)` callback. This module:
 *   1. Validates `dependsOn` against the sibling args (must exist, must have
 *      static `choices` or an enum schema, no chaining).
 *   2. Walks the cartesian product of those static value lists.
 *   3. Calls `enumerate` for each combination and normalises the candidates.
 *   4. Stores the resolved table on the field's `valueCompletion`.
 *
 * Runs once per shell-script generation. Errors throw with the offending
 * field name so misconfiguration surfaces before the script is written.
 */

import type { ExpandCompletion, ResolvedExpandCandidate } from "../core/expand-completion-types.js";
import type {
  CompletableOption,
  CompletableSubcommand,
  ExpandTableEntry,
  ValueCompletion,
} from "./types.js";

/** Information about a single field that needs its expand spec resolved. */
export interface PendingExpandTarget {
  /** Sibling-lookup key (camelCase field name). */
  name: string;
  /** Human-readable label (e.g. `--field` or `<endpoint>`) used in errors. */
  describe: string;
  /** Setter that writes the resolved `ValueCompletion` onto the field. */
  set: (vc: ValueCompletion) => void;
  /** The unresolved spec from the user. */
  spec: ExpandCompletion;
}

/**
 * Resolve every pending `expand` spec on a subcommand. The static extractor
 * collects pending targets while building options/positionals (it sees the
 * sentinel via `resolveValueCompletion`) and passes them here once siblings
 * are known.
 */
export function resolveExpandTargets(
  sub: CompletableSubcommand,
  targets: readonly PendingExpandTarget[],
  globalOptions: readonly CompletableOption[] = [],
): void {
  if (targets.length === 0) return;
  const siblingIndex = buildSiblingIndex(sub, globalOptions);
  for (const target of targets) {
    target.set(resolveOne(target, siblingIndex));
  }
}

/**
 * Build a name → static-values map for siblings, using each field's already
 * resolved `valueCompletion`. Only `choices`-typed completions count;
 * referencing anything else from `dependsOn` is reported as a clean error
 * in {@link resolveOne}. Global options with static choices are merged in
 * so a local expand can declare `dependsOn: ["env"]` against a global
 * \`env\` field — runtime propagates the global value to every frame, so
 * the resolved table must cover those combinations too.
 */
function buildSiblingIndex(
  sub: CompletableSubcommand,
  globalOptions: readonly CompletableOption[],
): Map<string, readonly string[]> {
  const index = new Map<string, readonly string[]>();
  // Names a local field claims — even when the local has no static
  // choices. Without this, a local arg shadowing a same-named global
  // arg would silently bind the dep to the global's choices while the
  // generated tracker still reads from the local value bucket. Reserving
  // the name here forces `resolveOne` to throw, surfacing the schema
  // mismatch instead of producing wrong candidates.
  const claimedByLocal = new Set<string>();
  for (const field of [...sub.options, ...sub.positionals]) claimedByLocal.add(field.name);
  const visit = (
    fields: readonly { name: string; valueCompletion?: ValueCompletion | undefined }[],
    fromGlobal: boolean,
  ): void => {
    for (const field of fields) {
      if (index.has(field.name)) continue;
      if (fromGlobal && claimedByLocal.has(field.name)) continue;
      const vc = field.valueCompletion;
      if (vc?.type === "choices" && vc.choices && vc.choices.length > 0) {
        index.set(field.name, vc.choices);
      }
    }
  };
  visit([...sub.options, ...sub.positionals], false);
  visit(globalOptions, true);
  return index;
}

function resolveOne(
  target: PendingExpandTarget,
  siblings: Map<string, readonly string[]>,
): ValueCompletion {
  const { spec } = target;
  const deps = spec.dependsOn;

  if (deps.length === 0) {
    throw new Error(
      `Field "${target.describe}": completion.custom.expand.dependsOn must list at least one sibling arg.`,
    );
  }

  const valueLists: string[][] = [];
  for (const dep of deps) {
    if (dep === target.name) {
      throw new Error(
        `Field "${target.describe}": completion.custom.expand.dependsOn cannot reference the field itself ("${dep}").`,
      );
    }
    const values = siblings.get(dep);
    if (!values) {
      throw new Error(
        `Field "${target.describe}": completion.custom.expand.dependsOn references "${dep}", which is not a sibling arg with a static \`choices\`/enum schema on the same command. Chaining expand specs is not supported.`,
      );
    }
    valueLists.push([...values]);
  }

  const table: ExpandTableEntry[] = [];
  for (const combo of cartesian(valueLists)) {
    const depsRecord: Record<string, string> = {};
    deps.forEach((name, idx) => {
      depsRecord[name] = combo[idx]!;
    });

    let raw: ReturnType<typeof spec.enumerate>;
    try {
      raw = spec.enumerate(depsRecord);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Field "${target.describe}": completion.custom.expand.enumerate threw for deps=${JSON.stringify(depsRecord)}: ${cause}`,
      );
    }

    const candidates = normaliseCandidates(raw);
    if (candidates.length === 0) continue;
    table.push({ key: combo, candidates });
  }

  return {
    type: "expand",
    dependsOn: deps,
    table,
  };
}

function normaliseCandidates(
  raw: ReadonlyArray<string | { value: string; description?: string }>,
): ResolvedExpandCandidate[] {
  const out: ResolvedExpandCandidate[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const value = typeof item === "string" ? item : item.value;
    if (seen.has(value)) continue;
    seen.add(value);
    const entry: ResolvedExpandCandidate = { value };
    // Guarded so `exactOptionalPropertyTypes` doesn't reject `undefined`.
    if (typeof item !== "string" && item.description !== undefined) {
      entry.description = item.description;
    }
    out.push(entry);
  }
  return out;
}

function* cartesian(lists: readonly string[][]): Generator<string[]> {
  if (lists.length === 0) {
    yield [];
    return;
  }
  const indices = Array.from<number>({ length: lists.length }).fill(0);
  while (true) {
    yield indices.map((i, dim) => lists[dim]![i]!);
    let dim = lists.length - 1;
    while (dim >= 0) {
      indices[dim]!++;
      if (indices[dim]! < lists[dim]!.length) break;
      indices[dim] = 0;
      dim--;
    }
    if (dim < 0) return;
  }
}
