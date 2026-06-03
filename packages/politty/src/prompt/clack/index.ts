import { confirm, isCancel, password, select, text } from "@clack/prompts";
import type { PromptResolver } from "../../types.js";
import { promptMissingArgs } from "../index.js";
import type { PromptAdapter } from "../types.js";

function createClackAdapter(): PromptAdapter {
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

/**
 * Prompt resolver backed by @clack/prompts.
 *
 * @example
 * ```ts
 * import { runMain, defineCommand } from "politty";
 * import { prompt } from "politty/prompt/clack";
 *
 * runMain(cmd, { version: "1.0.0", prompt });
 * ```
 */
export const prompt: PromptResolver = (rawArgs, extracted) =>
  promptMissingArgs(rawArgs, extracted, { adapter: createClackAdapter() });
