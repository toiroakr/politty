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
  const rawType = resolvePromptType(field, promptMeta);
  const choices = resolveChoices(field, promptMeta, rawType);
  // Fall back to text when select has no choices to avoid adapter crash
  const type = rawType === "select" && !choices ? "text" : rawType;

  return { field, type, message, ...(choices && { choices }) };
}

function hasChoices(list: unknown[] | undefined): list is unknown[] {
  return list !== undefined && list.length > 0;
}

function resolvePromptType(
  field: ResolvedFieldMeta,
  promptMeta: NonNullable<ResolvedFieldMeta["prompt"]>,
): ResolvedPromptConfig["type"] {
  // Priority 1: Explicit type
  if (promptMeta.type) {
    return promptMeta.type === "file" || promptMeta.type === "directory" ? "text" : promptMeta.type;
  }
  // Priority 2: Explicit choices
  if (hasChoices(promptMeta.choices)) return "select";
  // Priority 3: Inherited from completion type
  if (field.completion?.type === "file" || field.completion?.type === "directory") {
    return "text";
  }
  // Priority 4: Auto-detect from schema
  if (hasChoices(field.enumValues)) return "select";
  if (field.type === "boolean") return "confirm";
  return "text";
}

function resolveChoices(
  field: ResolvedFieldMeta,
  promptMeta: NonNullable<ResolvedFieldMeta["prompt"]>,
  type: ResolvedPromptConfig["type"],
): ResolvedPromptConfig["choices"] | undefined {
  // Explicit choices always win
  if (hasChoices(promptMeta.choices)) {
    return promptMeta.choices.map((c) => (typeof c === "string" ? { label: c, value: c } : c));
  }
  // Auto-populate from enum values for select type
  if (type === "select" && hasChoices(field.enumValues)) {
    return field.enumValues.map((v) => ({ label: v, value: v }));
  }
  return undefined;
}

/**
 * Filter fields that need prompting (missing value + prompt configured).
 *
 * For discriminatedUnion schemas, variant-aware narrowing is handled by the
 * caller (promptMissingArgs) which prompts the discriminator first and then
 * passes only the active variant's fields. For plain union schemas, this
 * iterates all fields across every variant without narrowing.
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
