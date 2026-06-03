/**
 * Generate completion candidates based on context
 */

import { execSync } from "node:child_process";
import type { DynamicCompletionContext } from "../../core/dynamic-completion-types.js";
import { resolveSubCommandAlias } from "../../executor/subcommand-router.js";
import { resolveSubCommandMeta } from "../../lazy.js";
import type { CompletablePositional, ShellType, ValueCompletion } from "../types.js";
import { clampToVariadic, type CompletionContext } from "./context-parser.js";

/**
 * Completion directive flags (bitwise)
 */
export const CompletionDirective = {
  /** Default completion behavior */
  Default: 0,
  /** Don't add space after completion */
  NoSpace: 1,
  /** Don't offer file completion (even if no other completions) */
  NoFileCompletion: 2,
  /** Filter completions using current word as prefix */
  FilterPrefix: 4,
  /** Keep the order of completions */
  KeepOrder: 8,
  /** Trigger file completion */
  FileCompletion: 16,
  /** Trigger directory completion */
  DirectoryCompletion: 32,
  /** Error occurred during completion */
  Error: 64,
} as const;

/**
 * A completion candidate
 */
export interface CompletionCandidate {
  /** The completion value */
  value: string;
  /** Optional description */
  description?: string | undefined;
  /** Type hint for display purposes */
  type?: "option" | "subcommand" | "value" | "file" | "directory";
}

/**
 * Result of candidate generation
 */
export interface CandidateResult {
  /** Completion candidates */
  candidates: CompletionCandidate[];
  /** Directive flags for shell behavior */
  directive: number;
  /** File extensions for shell-native filtering (e.g., ["json", "yaml"]) */
  fileExtensions?: string[] | undefined;
  /** Glob patterns for shell-native file matching (e.g., [".env.*"]) */
  fileMatchers?: string[] | undefined;
}

/**
 * Options for candidate generation.
 */
export interface GenerateCandidatesOptions {
  /**
   * Target shell. Forwarded to dynamic resolvers so they can vary output
   * (e.g. include descriptions only for shells that render them).
   */
  shell: ShellType;
}

/**
 * Detect an inline `--opt=` prefix on an option-value `currentWord`.
 * Mirrors what the shell scripts already strip via `_inline_prefix`, so
 * resolvers see only the value portion (e.g. `foo` for `--field=foo`).
 * Positional words are excluded: `cli -- --foo=bar` is a legitimate
 * positional value, not an inline option assignment.
 */
export function detectInlineOptionPrefix(currentWord: string): string | undefined {
  if (!currentWord.startsWith("-")) return undefined;
  const eqIdx = currentWord.indexOf("=");
  if (eqIdx <= 0) return undefined;
  return currentWord.slice(0, eqIdx + 1);
}

/**
 * Generate completion candidates based on context.
 *
 * Async because dynamic resolvers may return promises. Sync completion
 * sources (choices/file/directory/command/none, subcommand, option name)
 * still resolve synchronously and the await is a no-op for them.
 *
 * Inline option-value prefixes (`--field=foo`) on the option-value path
 * are stripped here so resolvers and post-processing always see the
 * value portion regardless of whether the caller pre-normalized.
 */
export async function generateCandidates(
  context: CompletionContext,
  options: GenerateCandidatesOptions,
): Promise<CandidateResult> {
  switch (context.completionType) {
    case "subcommand":
      return generateSubcommandCandidates(context);
    case "option-name":
      return generateOptionNameCandidates(context);
    case "option-value": {
      const opt = context.targetOption;
      const inlinePrefix = opt ? detectInlineOptionPrefix(context.currentWord) : undefined;
      const effectiveContext = inlinePrefix
        ? { ...context, currentWord: context.currentWord.slice(inlinePrefix.length) }
        : context;
      return generateValueCandidates(effectiveContext, options, opt?.name, opt?.valueCompletion);
    }
    case "positional": {
      const positional = resolvePositionalTarget(context);
      return generateValueCandidates(
        context,
        options,
        positional?.name,
        positional?.valueCompletion,
        positional?.description,
      );
    }
  }
}

/**
 * Pick the positional whose `valueCompletion` should drive the current
 * cursor. Clamps to the trailing variadic positional so a value beyond
 * the schema's positional count still resolves to the variadic slot —
 * but only when that slot IS variadic; otherwise a non-variadic last
 * positional must not greedily absorb the extra value.
 */
function resolvePositionalTarget(context: CompletionContext): CompletablePositional | undefined {
  const requestedIdx = context.positionalIndex ?? 0;
  const clampedIdx = clampToVariadic(requestedIdx, context.positionals);
  if (clampedIdx === undefined) return undefined;
  const candidate = context.positionals[clampedIdx];
  if (!candidate) return undefined;
  return clampedIdx === requestedIdx || candidate.variadic ? candidate : undefined;
}

/**
 * Execute a shell command and return results as candidates
 */
function executeShellCommand(command: string): CompletionCandidate[] {
  try {
    const output = execSync(command, { encoding: "utf-8", timeout: 5000 });
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => ({ value: line, type: "value" as const }));
  } catch {
    return [];
  }
}

/**
 * Two-stage `key=value` post-processing. Returns the transformed candidate
 * list plus whether it contains a bare `key=` entry so the caller can flip
 * NoSpace and let the user keep typing past the first TAB.
 *
 * Key stage (`=` not yet typed): collapse every `key=value` candidate to a
 * unique `key=` entry so the first TAB picks the key.
 *
 * Value stage (`=` typed): drop only the bare `<key>=` candidate that
 * echoes the prefix the user already typed. A blanket `endsWith("=")`
 * filter would also remove legitimate values such as base64 `key=YWJj=` or
 * value-only `YWJj=` (padding), so match the candidate string exactly
 * against the typed key prefix.
 */
function applyKeyValuePostProcessing(
  candidates: readonly CompletionCandidate[],
  currentWord: string,
): { candidates: CompletionCandidate[]; hasEqSuffix: boolean } {
  const keyStage = !currentWord.includes("=");
  const processed = keyStage
    ? collapseToKeys(candidates)
    : dropBareKeyEcho(candidates, currentWord);
  // Flip NoSpace only at key stage where a candidate ending with `=`
  // really is a bare-key marker. At value stage a candidate like
  // `YWJj=` is a concrete value, so NoSpace would incorrectly suppress
  // the trailing space after a regular value selection.
  return {
    candidates: processed,
    hasEqSuffix: keyStage && processed.some((c) => c.value.endsWith("=")),
  };
}

function collapseToKeys(candidates: readonly CompletionCandidate[]): CompletionCandidate[] {
  const seen = new Set<string>();
  const out: CompletionCandidate[] = [];
  for (const c of candidates) {
    const eqIdx = c.value.indexOf("=");
    if (eqIdx <= 0) {
      out.push(c);
      continue;
    }
    const keyPart = c.value.slice(0, eqIdx + 1);
    if (seen.has(keyPart)) continue;
    seen.add(keyPart);
    out.push({ ...c, value: keyPart });
  }
  return out;
}

function dropBareKeyEcho(
  candidates: readonly CompletionCandidate[],
  currentWord: string,
): CompletionCandidate[] {
  const keyPrefix = currentWord.slice(0, currentWord.indexOf("=") + 1);
  return candidates.filter((c) => c.value !== keyPrefix);
}

/**
 * Resolve value completion, executing shell commands and file lookups in JS
 */
async function resolveValueCandidates(
  vc: ValueCompletion,
  ctx: DynamicCompletionContext,
  description?: string,
): Promise<CandidateResult> {
  const candidates: CompletionCandidate[] = [];
  let directive: number = CompletionDirective.FilterPrefix;
  let fileExtensions: string[] | undefined;
  let fileMatchers: string[] | undefined;

  switch (vc.type) {
    case "choices":
      if (vc.choices) {
        for (const choice of vc.choices) {
          candidates.push({
            value: choice,
            description,
            type: "value",
          });
        }
      }
      directive |= CompletionDirective.NoFileCompletion;
      break;

    case "file":
      if (vc.matcher && vc.matcher.length > 0) {
        // Delegate to shell with glob matcher metadata
        fileMatchers = vc.matcher.filter((m) => m.trim().length > 0);
        if (fileMatchers.length === 0) {
          fileMatchers = undefined;
          directive |= CompletionDirective.FileCompletion;
        }
      } else if (vc.extensions && vc.extensions.length > 0) {
        // Delegate to shell with extension filter metadata
        fileExtensions = Array.from(
          new Set(
            vc.extensions
              .map((ext) => ext.trim().replace(/^\./, ""))
              .filter((ext) => ext.length > 0),
          ),
        );
        if (fileExtensions.length === 0) {
          // All extensions were invalid → treat as unfiltered file completion
          fileExtensions = undefined;
          directive |= CompletionDirective.FileCompletion;
        }
      } else {
        // No extensions or matchers: let shell handle native file completion
        directive |= CompletionDirective.FileCompletion;
      }
      break;

    case "directory":
      directive |= CompletionDirective.DirectoryCompletion;
      break;

    case "command":
      // Execute shell command in JS and add results as candidates
      if (vc.shellCommand) {
        candidates.push(...executeShellCommand(vc.shellCommand));
      }
      directive |= CompletionDirective.NoFileCompletion;
      break;

    case "none":
      directive |= CompletionDirective.NoFileCompletion;
      break;

    case "dynamic": {
      try {
        const result = await vc.resolve(ctx);
        for (const c of result.candidates) {
          const normalized = typeof c === "string" ? { value: c } : c;
          candidates.push({ ...normalized, type: "value" });
        }
        directive =
          result.directive ??
          CompletionDirective.FilterPrefix | CompletionDirective.NoFileCompletion;
      } catch {
        // Resolver failures must not break the user's shell. Surface an
        // empty candidate set with the Error directive so callers that care
        // can detect a faulted resolver.
        directive = CompletionDirective.NoFileCompletion | CompletionDirective.Error;
      }
      break;
    }

    case "expand":
      // `expand` candidates are inlined into the static shell script at
      // generation time, so the dynamic path never delegates to us for an
      // expand field. This case is reachable only if a caller invokes
      // `__complete` for an expand field directly (e.g. from tests). Return
      // no candidates with `NoFileCompletion` to mirror the choices/none
      // shapes.
      directive |= CompletionDirective.NoFileCompletion;
      break;
  }

  // Two-stage key=value: collapse to keys before `=` is typed, and flip
  // NoSpace whenever a candidate ends with `=` so the user can keep
  // typing the value after the first TAB. Apply only to `dynamic` and
  // `expand` sources — `choices`/`shellCommand` values containing `=`
  // are concrete (e.g. `foo=bar` literal choice) and must reach the
  // shell unchanged, matching what the static script paths emit.
  if (vc.type === "dynamic" || vc.type === "expand") {
    const processed = applyKeyValuePostProcessing(candidates, ctx.currentWord);
    if (processed.hasEqSuffix) {
      directive |= CompletionDirective.NoSpace;
    }
    return {
      candidates: processed.candidates,
      directive,
      fileExtensions,
      fileMatchers,
    };
  }

  return { candidates, directive, fileExtensions, fileMatchers };
}

/**
 * Generate subcommand candidates
 */
function generateSubcommandCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];

  // Add subcommands (context.subcommands already includes aliases)
  for (const name of context.subcommands) {
    // Direct lookup first, fall back to alias resolution.
    const subs = context.currentCommand.subCommands;
    const direct = subs?.[name];
    const aliasCanonical = direct
      ? undefined
      : resolveSubCommandAlias(context.currentCommand, name);
    const resolved = direct ?? (aliasCanonical ? subs?.[aliasCanonical] : undefined);
    const description = resolved ? resolveSubCommandMeta(resolved)?.description : undefined;

    candidates.push({
      value: name,
      description,
      type: "subcommand",
    });
  }

  // Add options when no subcommands exist, or when typing an option prefix
  if (candidates.length === 0 || context.currentWord.startsWith("-")) {
    const optionResult = generateOptionNameCandidates(context);
    candidates.push(...optionResult.candidates);
  }

  return { candidates, directive: CompletionDirective.FilterPrefix };
}

/**
 * Generate option name candidates
 */
function generateOptionNameCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];

  // Filter out already used options
  const availableOptions = context.options.filter((opt) => {
    // Array options can be specified multiple times, so keep them available.
    if (opt.valueType === "array") {
      return true;
    }

    if (context.usedOptions.has(opt.cliName)) return false;
    if (opt.alias && opt.alias.some((a) => context.usedOptions.has(a))) return false;
    // The negation form shares the field's "used" slot: if either the positive
    // flag or its negation has already been typed, suppress both.
    if (opt.negation && context.usedOptions.has(opt.negation)) return false;
    return true;
  });

  for (const opt of availableOptions) {
    candidates.push({
      value: `--${opt.cliName}`,
      description: opt.description,
      type: "option",
    });
    if (opt.negation) {
      candidates.push({
        value: `--${opt.negation}`,
        description: opt.negationDescription ?? opt.description,
        type: "option",
      });
    }
  }

  // Add help option if not already used
  if (!context.usedOptions.has("help")) {
    candidates.push({
      value: "--help",
      description: "Show help information",
      type: "option",
    });
  }

  return { candidates, directive: CompletionDirective.FilterPrefix };
}

/**
 * Build the resolver-invocation slice of CompletionContext.
 * `currentWord` reaches resolvers normalized by `generateCandidates` —
 * the option-value path strips any inline `--field=` prefix first, so
 * resolvers and the key=value post-processing only ever see the value
 * portion. The target field is dropped from `parsedArgs` so resolvers
 * can treat it as "other args": for repeatable options and variadic
 * positionals the parser already stages already-typed values under the
 * same key, and exposing them under both `parsedArgs` and `previousValues`
 * would let a resolver mistake the in-flight field for a fully-supplied
 * sibling.
 */
function resolverContext(
  context: CompletionContext,
  options: GenerateCandidatesOptions,
  targetFieldName: string | undefined,
): DynamicCompletionContext {
  return {
    currentWord: context.currentWord,
    shell: options.shell,
    parsedArgs: parsedArgsWithoutTarget(context.parsedArgs, targetFieldName),
    previousValues: context.previousValues,
    subcommandPath: context.subcommandPath,
  };
}

function parsedArgsWithoutTarget(
  parsedArgs: Record<string, unknown>,
  key: string | undefined,
): Record<string, unknown> {
  if (key === undefined || !(key in parsedArgs)) return parsedArgs;
  const next = { ...parsedArgs };
  delete next[key];
  return next;
}

/**
 * Generate value candidates for either an option or a positional. Both paths
 * resolve the same way once their target field is identified. `description`
 * is propagated to choices candidates (positional path supplies it; option
 * path does not, mirroring the prior split implementations).
 */
async function generateValueCandidates(
  context: CompletionContext,
  options: GenerateCandidatesOptions,
  targetFieldName: string | undefined,
  vc: ValueCompletion | undefined,
  description?: string,
): Promise<CandidateResult> {
  if (!vc) {
    return { candidates: [], directive: CompletionDirective.FilterPrefix };
  }
  return resolveValueCandidates(
    vc,
    resolverContext(context, options, targetFieldName),
    description,
  );
}
