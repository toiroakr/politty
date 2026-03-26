import type { ResolvedFieldMeta } from "../core/schema-extractor.js";
import type { ResolvedPromptConfig } from "./types.js";

/**
 * Resolve prompt configuration for a field.
 *
 * Priority for prompt type:
 * 1. Explicit type from prompt.type
 * 2. Explicit choices from prompt.choices (forces "select")
 * 3. Inherited from completion metadata (file/directory -> "text")
 * 4. Auto-detected from Zod schema type:
 *    - enum (has enumValues) -> "select"
 *    - boolean -> "confirm"
 *    - string/number/unknown -> "text"
 *
 * Returns null if the field has no prompt metadata or prompting is disabled.
 */
export function resolvePromptConfig(field: ResolvedFieldMeta): ResolvedPromptConfig | null {
  const promptMeta = field.prompt;
  if (!promptMeta || promptMeta.enabled === false) return null;

  const message = promptMeta.message ?? field.description ?? field.name;

  let type: ResolvedPromptConfig["type"];
  let choices: ResolvedPromptConfig["choices"] | undefined;

  // Priority 1: Explicit type
  if (promptMeta.type) {
    type = promptMeta.type === "file" || promptMeta.type === "directory" ? "text" : promptMeta.type;
  }
  // Priority 2: Explicit choices
  else if (promptMeta.choices && promptMeta.choices.length > 0) {
    type = "select";
  }
  // Priority 3: Inherited from completion type
  else if (field.completion?.type === "file" || field.completion?.type === "directory") {
    type = "text";
  }
  // Priority 4: Auto-detect from schema
  else if (field.enumValues && field.enumValues.length > 0) {
    type = "select";
    choices = field.enumValues.map((v) => ({ label: v, value: v }));
  } else if (field.type === "boolean") {
    type = "confirm";
  } else {
    type = "text";
  }

  // Populate choices from enum values when type is "select" but no choices set yet
  // (handles explicit prompt.type: "select" on an enum field)
  if (
    type === "select" &&
    choices === undefined &&
    field.enumValues &&
    field.enumValues.length > 0
  ) {
    choices = field.enumValues.map((v) => ({ label: v, value: v }));
  }

  // Explicit choices override auto-detected ones
  if (promptMeta.choices && promptMeta.choices.length > 0) {
    choices = promptMeta.choices.map((c) => (typeof c === "string" ? { label: c, value: c } : c));
  }

  const result: ResolvedPromptConfig = { field, type, message };
  if (choices !== undefined) {
    result.choices = choices;
  }
  return result;
}

/**
 * Filter fields that need prompting (missing value + prompt configured).
 *
 * Known limitation: for union/discriminatedUnion schemas, this iterates all
 * fields across every variant without checking which variant is active.
 * Variant-aware filtering requires the discriminator value from rawArgs and
 * the ExtractedFields.variants metadata, which is not available here.
 *
 * Fields with Zod defaults that also have prompt metadata will be prompted
 * when the raw value is undefined. This is intentional: `prompt: {}` is an
 * explicit opt-in to interactive input. Omit prompt metadata to let the
 * default apply silently.
 */
export function getFieldsToPrompt(
  fields: ResolvedFieldMeta[],
  rawArgs: Record<string, unknown>,
): ResolvedPromptConfig[] {
  const configs: ResolvedPromptConfig[] = [];
  for (const field of fields) {
    if (rawArgs[field.name] !== undefined) continue;
    // Array fields are not supported for interactive prompting yet;
    // a scalar text response would fail Zod array validation.
    if (field.type === "array") continue;
    const config = resolvePromptConfig(field);
    if (config) configs.push(config);
  }
  return configs;
}
