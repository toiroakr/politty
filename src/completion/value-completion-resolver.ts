/**
 * Shared value completion resolver
 *
 * Resolves value completion metadata from field information.
 * Used by both the static extractor and the dynamic context parser.
 */

import type { ValueCompletion } from "./types.js";

/**
 * Minimal field interface needed for resolving value completion.
 * Both ResolvedFieldMeta and inline context-parser types satisfy this.
 */
export interface ValueCompletionField {
  completion?:
    | {
        type?: string;
        custom?: { choices?: string[]; shellCommand?: string };
        extensions?: string[];
      }
    | undefined;
  enumValues?: string[] | undefined;
}

/**
 * Resolve value completion from field metadata
 *
 * Priority:
 * 1. Explicit custom completion (choices or shellCommand)
 * 2. Explicit completion type (file, directory, none)
 * 3. Auto-detected enum values from schema
 */
export function resolveValueCompletion(field: ValueCompletionField): ValueCompletion | undefined {
  const meta = field.completion;

  // Priority 1: Explicit custom completion
  if (meta?.custom) {
    if (meta.custom.choices && meta.custom.choices.length > 0) {
      return { type: "choices", choices: meta.custom.choices };
    }
    if (meta.custom.shellCommand) {
      return { type: "command", shellCommand: meta.custom.shellCommand };
    }
  }

  // Priority 2: Explicit completion type
  if (meta?.type) {
    if (meta.type === "file") {
      return meta.extensions ? { type: "file", extensions: meta.extensions } : { type: "file" };
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
