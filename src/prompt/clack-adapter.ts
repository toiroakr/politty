import { confirm, isCancel, password, select, text } from "@clack/prompts";
import type { PromptAdapter } from "./types.js";

/**
 * Create a prompt adapter backed by @clack/prompts.
 */
export function createClackAdapter(): PromptAdapter {
  return {
    text(config) {
      const opts: Parameters<typeof text>[0] = { message: config.message };
      if (config.placeholder !== undefined) {
        opts.placeholder = config.placeholder;
      }
      return text(opts);
    },
    password(config) {
      return password({ message: config.message });
    },
    confirm(config) {
      return confirm({ message: config.message });
    },
    select(config) {
      return select({ message: config.message, options: config.options });
    },
    isCancelled(value) {
      return isCancel(value);
    },
  };
}
