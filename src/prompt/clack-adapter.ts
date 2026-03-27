import { confirm, isCancel, password, select, text } from "@clack/prompts";
import type { PromptAdapter } from "./types.js";

/**
 * Create a prompt adapter backed by @clack/prompts.
 */
export function createClackAdapter(): PromptAdapter {
  return {
    text: (config) =>
      text({
        message: config.message,
        ...(config.placeholder !== undefined && { placeholder: config.placeholder }),
      }),
    password: (config) => password(config),
    confirm: (config) => confirm(config),
    select: (config) => select(config),
    isCancelled: isCancel,
  };
}
