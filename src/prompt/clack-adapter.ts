import { confirm, isCancel, password, select, text } from "@clack/prompts";
import type { PromptAdapter } from "./types.js";

/**
 * Create a prompt adapter backed by @clack/prompts.
 */
export function createClackAdapter(): PromptAdapter {
  return {
    text(config) {
      // clack's text() does not accept undefined for placeholder
      const opts: Parameters<typeof text>[0] = { message: config.message };
      if (config.placeholder !== undefined) opts.placeholder = config.placeholder;
      return text(opts);
    },
    password: (config) => password(config),
    confirm: (config) => confirm(config),
    select: (config) => select(config),
    isCancelled: isCancel,
  };
}
