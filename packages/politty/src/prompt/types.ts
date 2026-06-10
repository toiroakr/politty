import type { ResolvedFieldMeta } from "../core/schema-extractor.js";

/**
 * Resolved prompt configuration for a single field
 */
export interface ResolvedPromptConfig {
  /** Field metadata */
  field: ResolvedFieldMeta;
  /** Resolved prompt type */
  type: "text" | "password" | "confirm" | "select";
  /** Message to display to the user */
  message: string;
  /** Choices for select prompts */
  choices?: Array<{ label: string; value: string }>;
}

/**
 * Adapter interface for prompt rendering.
 * Implement this to use a custom prompt library instead of the default @clack/prompts.
 */
export interface PromptAdapter {
  /** Prompt for free-form text input */
  text(config: { message: string; placeholder?: string | undefined }): Promise<string | symbol>;
  /** Prompt for masked text input */
  password(config: { message: string }): Promise<string | symbol>;
  /** Prompt for yes/no confirmation */
  confirm(config: { message: string }): Promise<boolean | symbol>;
  /** Prompt for single selection from options */
  select(config: {
    message: string;
    options: Array<{ label: string; value: string }>;
  }): Promise<string | symbol>;
  /** Check if a prompt result indicates user cancellation */
  isCancelled(value: unknown): boolean;
}
