/**
 * Shared value completion resolver
 *
 * Resolves value completion metadata from field information.
 * Used by both the static extractor and the dynamic context parser.
 */

import type { DynamicCompletionResolver } from "../core/dynamic-completion-types.js";
import type { ValueCompletion } from "./types.js";

/**
 * Minimal field interface needed for resolving value completion.
 * Both ResolvedFieldMeta and inline context-parser types satisfy this.
 */
export interface ValueCompletionField {
  completion?:
    | ({
        type?: string;
        custom?: {
          choices?: string[];
          shellCommand?: string;
          resolve?: DynamicCompletionResolver;
        };
      } & ({ extensions?: string[]; matcher?: never } | { matcher?: string[]; extensions?: never }))
    | undefined;
  enumValues?: string[] | undefined;
  /** Field name surfaced in error messages when custom variants are mixed. */
  name?: string;
}

/**
 * Resolve value completion from field metadata.
 *
 * Priority (within `custom`): `resolve` > `choices` > `shellCommand`.
 * Specifying more than one of these on the same field throws so the
 * misconfiguration surfaces at command-definition time rather than at
 * completion time.
 *
 * Outside `custom`: explicit `type` (file/directory/none) > auto-detected
 * enum values from the schema.
 */
export function resolveValueCompletion(field: ValueCompletionField): ValueCompletion | undefined {
  const meta = field.completion;

  if (meta?.custom) {
    const c = meta.custom;
    const definedKeys: string[] = [];
    if (c.resolve) definedKeys.push("resolve");
    if (c.choices && c.choices.length > 0) definedKeys.push("choices");
    if (c.shellCommand) definedKeys.push("shellCommand");

    if (definedKeys.length > 1) {
      throw new Error(
        `Field "${field.name ?? "<unknown>"}": completion.custom may only specify one of choices, shellCommand, resolve (got ${definedKeys.join(", ")}).`,
      );
    }

    if (c.resolve) {
      return { type: "dynamic", resolve: c.resolve };
    }
    if (c.choices && c.choices.length > 0) {
      return { type: "choices", choices: c.choices };
    }
    if (c.shellCommand) {
      return { type: "command", shellCommand: c.shellCommand };
    }
  }

  // Priority 2: Explicit completion type
  if (meta?.type) {
    if (meta.type === "file") {
      if (meta.matcher) return { type: "file", matcher: meta.matcher };
      if (meta.extensions) return { type: "file", extensions: meta.extensions };
      return { type: "file" };
    }
    if (meta.type === "directory") {
      return { type: "directory" };
    }
    if (meta.type === "none") {
      return { type: "none" };
    }
  }

  // Priority 3: Auto-detect from enum schema
  if (field.enumValues && field.enumValues.length > 0) {
    return { type: "choices", choices: field.enumValues };
  }

  return undefined;
}
