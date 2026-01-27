import type {
  FieldPromptFunction,
  PromptFieldInfo,
  PromptFunctions,
  PromptType,
} from "../types.js";
import { determinePromptType, getFieldPromptFunction } from "./field-selector.js";

/**
 * Error thrown when @inquirer/prompts is not installed
 */
export class PromptLibraryNotInstalledError extends Error {
  constructor() {
    super(
      "Interactive mode requires @inquirer/prompts. " +
        "Install it with: npm install @inquirer/prompts\n" +
        "Or provide custom prompt functions in the interactive config.",
    );
    this.name = "PromptLibraryNotInstalledError";
  }
}

/**
 * Dynamically import @inquirer/prompts
 * Returns null if not installed
 */
async function loadInquirerPrompts(): Promise<typeof import("@inquirer/prompts") | null> {
  try {
    return await import("@inquirer/prompts");
  } catch {
    return null;
  }
}

/**
 * Create default prompt functions using @inquirer/prompts
 */
export async function createDefaultPromptFunctions(): Promise<PromptFunctions> {
  const prompts = await loadInquirerPrompts();

  if (!prompts) {
    throw new PromptLibraryNotInstalledError();
  }

  return {
    input: async (field: PromptFieldInfo) => {
      const answer = await prompts.input({
        message: field.promptMessage ?? field.description ?? `Enter ${field.cliName}`,
        default:
          field.currentValue != null ? String(field.currentValue) : (field.defaultValue as string),
        validate: (value) => {
          if (field.required && !value) {
            return "This field is required";
          }
          return true;
        },
      });

      // Convert to number if needed
      if (field.type === "number") {
        const num = Number(answer);
        return Number.isNaN(num) ? answer : num;
      }

      return answer || undefined;
    },

    confirm: async (field: PromptFieldInfo) => {
      return prompts.confirm({
        message: field.promptMessage ?? field.description ?? field.cliName,
        default: (field.currentValue as boolean) ?? (field.defaultValue as boolean) ?? false,
      });
    },

    select: async (field: PromptFieldInfo) => {
      const choices = (field.choices ?? []).map((value) => ({
        name: value,
        value,
      }));

      if (choices.length === 0) {
        // Fallback to input if no choices
        return prompts.input({
          message: field.promptMessage ?? field.description ?? `Enter ${field.cliName}`,
          default: (field.currentValue as string) ?? (field.defaultValue as string),
        });
      }

      return prompts.select({
        message: field.promptMessage ?? field.description ?? field.cliName,
        choices,
        default: (field.currentValue as string) ?? (field.defaultValue as string),
      });
    },

    checkbox: async (field: PromptFieldInfo) => {
      const choices = (field.choices ?? []).map((value) => ({
        name: value,
        value,
      }));

      if (choices.length === 0) {
        // Fallback to input for comma-separated values
        const answer = await prompts.input({
          message: `${field.promptMessage ?? field.description ?? field.cliName} (comma-separated)`,
          default: (
            (field.currentValue as string[]) ??
            (field.defaultValue as string[]) ??
            []
          ).join(", "),
        });
        return answer
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
      }

      return prompts.checkbox({
        message: field.promptMessage ?? field.description ?? field.cliName,
        choices,
      });
    },

    password: async (field: PromptFieldInfo) => {
      return prompts.password({
        message: field.promptMessage ?? field.description ?? `Enter ${field.cliName}`,
        validate: (value) => {
          if (field.required && !value) {
            return "This field is required";
          }
          return true;
        },
      });
    },

    editor: async (field: PromptFieldInfo) => {
      return prompts.editor({
        message: field.promptMessage ?? field.description ?? `Enter ${field.cliName}`,
        default: (field.currentValue as string) ?? (field.defaultValue as string),
      });
    },
  };
}

/**
 * Execute prompts for all fields that need input
 *
 * @param fields - Fields to prompt for
 * @param customPrompts - Custom prompt functions from config
 * @returns Object with field names as keys and prompted values
 */
export async function executePrompts(
  fields: PromptFieldInfo[],
  customPrompts?: PromptFunctions,
): Promise<Record<string, unknown>> {
  if (fields.length === 0) {
    return {};
  }

  // Load default prompts lazily (only if needed)
  let defaultPrompts: PromptFunctions | null = null;

  const result: Record<string, unknown> = {};

  for (const field of fields) {
    // 1. Check for field-specific prompt function
    const fieldPrompt = getFieldPromptFunction(field);
    if (fieldPrompt) {
      result[field.name] = await fieldPrompt(field);
      continue;
    }

    // 2. Determine prompt type
    const promptType: PromptType = determinePromptType(field);

    // 3. Get prompt function (custom or default)
    let promptFn: FieldPromptFunction | undefined = customPrompts?.[promptType];

    if (!promptFn) {
      // Load default prompts if not already loaded
      if (!defaultPrompts) {
        defaultPrompts = await createDefaultPromptFunctions();
      }
      promptFn = defaultPrompts[promptType];
    }

    if (!promptFn) {
      throw new Error(`No prompt function available for type: ${promptType}`);
    }

    result[field.name] = await promptFn(field);
  }

  return result;
}
