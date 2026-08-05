/**
 * Types for in-process dynamic value completion.
 *
 * A `resolve` callback registered on `arg(...)` receives parsed context
 * (other arg values typed so far, previous values supplied to the same
 * option, the current word being completed, target shell) and returns
 * candidates. The callback runs inside the `__complete` command. Dispatcher
 * shell scripts call `__complete` for every completion request; static shell
 * scripts delegate to it for any spec that uses `resolve`.
 *
 * Defined under `core/` (not `completion/`) so `arg-registry.ts` can
 * reference the resolver type without crossing the lint-enforced
 * `completion → core` boundary.
 */

/** Bitmask combining `CompletionDirective` values. */
export type CompletionDirectiveMask = number;

export interface DynamicCompletionContext {
  /** Word being completed. `--field=` inline prefix is stripped before this is set. */
  currentWord: string;
  /** Target shell formatting requested by the caller. */
  shell: "bash" | "zsh" | "fish";
  /**
   * Best-effort parsed values of OTHER args on the same command, keyed by
   * camelCase name. Includes positionals and other options. Zod validation
   * is NOT applied; values are raw strings (or arrays of raw strings for
   * array-typed options/variadic positionals).
   */
  parsedArgs: Readonly<Record<string, unknown>>;
  /**
   * Values already supplied for the SAME option/positional being completed.
   * Useful for de-duplicating repeated array options.
   */
  previousValues: readonly string[];
  /**
   * Subcommand path from root (e.g. ["api"]). Reflects what the user
   * actually typed — aliases are NOT resolved to their canonical names, so
   * resolvers that branch on the path should accept every alias they care
   * about.
   */
  subcommandPath: readonly string[];
}

export interface DynamicCompletionCandidate {
  value: string;
  description?: string;
}

export interface DynamicCompletionResult {
  /** Candidates to surface. Strings or `{value, description}` objects. */
  candidates: Array<string | DynamicCompletionCandidate>;
  /**
   * Optional directive override. When omitted, defaults to
   * `FilterPrefix | NoFileCompletion` (matches `choices` behaviour).
   */
  directive?: CompletionDirectiveMask;
}

export type DynamicCompletionResolver = (
  ctx: DynamicCompletionContext,
) => DynamicCompletionResult | Promise<DynamicCompletionResult>;
