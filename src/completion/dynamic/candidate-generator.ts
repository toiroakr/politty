/**
 * Generate completion candidates based on context
 */

import { execSync } from "node:child_process";
import type { DynamicCompletionContext } from "../../core/dynamic-completion-types.js";
import { resolveSubCommandAlias } from "../../executor/subcommand-router.js";
import { resolveSubCommandMeta } from "../../lazy.js";
import type { ShellType, ValueCompletion } from "../types.js";
import type { CompletionContext } from "./context-parser.js";

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
 * Generate completion candidates based on context.
 *
 * Async because dynamic resolvers may return promises. Sync completion
 * sources (choices/file/directory/command/none, subcommand, option name)
 * still resolve synchronously and the await is a no-op for them.
 */
export async function generateCandidates(
  context: CompletionContext,
  options: GenerateCandidatesOptions,
): Promise<CandidateResult> {
  const candidates: CompletionCandidate[] = [];
  const directive = CompletionDirective.Default;

  switch (context.completionType) {
    case "subcommand":
      return generateSubcommandCandidates(context);

    case "option-name":
      return generateOptionNameCandidates(context);

    case "option-value":
      return generateOptionValueCandidates(context, options);

    case "positional":
      return generatePositionalCandidates(context, options);

    default:
      return { candidates, directive };
  }
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
 * Result of resolving value candidates
 */
type ValueResolutionResult = Pick<CandidateResult, "directive" | "fileExtensions" | "fileMatchers">;

/**
 * Resolve value completion, executing shell commands and file lookups in JS
 */
async function resolveValueCandidates(
  vc: ValueCompletion,
  candidates: CompletionCandidate[],
  ctx: DynamicCompletionContext,
  description?: string,
): Promise<ValueResolutionResult> {
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
  }

  return { directive, fileExtensions, fileMatchers };
}

/**
 * Generate subcommand candidates
 */
function generateSubcommandCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];
  let directive = CompletionDirective.FilterPrefix;

  // Add subcommands (context.subcommands already includes aliases)
  for (const name of context.subcommands) {
    // Try direct lookup first, then alias lookup
    let description: string | undefined;
    const sub = context.currentCommand.subCommands?.[name];
    if (sub) {
      description = resolveSubCommandMeta(sub)?.description;
    } else {
      const canonical = resolveSubCommandAlias(context.currentCommand, name);
      if (canonical) {
        const resolved = context.currentCommand.subCommands?.[canonical];
        if (resolved) {
          description = resolveSubCommandMeta(resolved)?.description;
        }
      }
    }

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

  return { candidates, directive };
}

/**
 * Generate option name candidates
 */
function generateOptionNameCandidates(context: CompletionContext): CandidateResult {
  const candidates: CompletionCandidate[] = [];
  const directive = CompletionDirective.FilterPrefix;

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

  return { candidates, directive };
}

/**
 * Build the resolver-invocation slice of CompletionContext.
 * `currentWord` is passed verbatim — the caller (`__complete`) strips inline
 * `--field=` prefixes before invoking us.
 */
function resolverContext(
  context: CompletionContext,
  options: GenerateCandidatesOptions,
): DynamicCompletionContext {
  return {
    currentWord: context.currentWord,
    shell: options.shell,
    parsedArgs: context.parsedArgs,
    previousValues: context.previousValues,
    subcommandPath: context.subcommandPath,
  };
}

/**
 * Generate option value candidates
 */
async function generateOptionValueCandidates(
  context: CompletionContext,
  options: GenerateCandidatesOptions,
): Promise<CandidateResult> {
  const candidates: CompletionCandidate[] = [];

  if (!context.targetOption) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const vc = context.targetOption.valueCompletion;
  if (!vc) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  return {
    candidates,
    ...(await resolveValueCandidates(vc, candidates, resolverContext(context, options))),
  };
}

/**
 * Generate positional argument candidates
 */
async function generatePositionalCandidates(
  context: CompletionContext,
  options: GenerateCandidatesOptions,
): Promise<CandidateResult> {
  const candidates: CompletionCandidate[] = [];

  // Get the positional at current index, clamping to last (variadic) positional
  const positionalIndex = context.positionalIndex ?? 0;
  const positional =
    context.positionals[positionalIndex] ??
    (context.positionals.at(-1)?.variadic ? context.positionals.at(-1) : undefined);

  if (!positional) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  const vc = positional.valueCompletion;
  if (!vc) {
    return { candidates, directive: CompletionDirective.FilterPrefix };
  }

  return {
    candidates,
    ...(await resolveValueCandidates(
      vc,
      candidates,
      resolverContext(context, options),
      positional.description,
    )),
  };
}
