import { confirm, input, password, select } from "@inquirer/prompts";
import type { PromptResolver } from "../../types.js";
import { promptMissingArgs } from "../index.js";
import type { PromptAdapter } from "../types.js";

const cancelSymbol = Symbol("inquirer-cancel");

async function wrapCancellation<T>(fn: () => Promise<T>): Promise<T | symbol> {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof Error && error.name === "ExitPromptError") {
      return cancelSymbol;
    }
    throw error;
  }
}

function createInquirerAdapter(): PromptAdapter {
  return {
    text: (config) =>
      wrapCancellation(() =>
        input({
          message: config.message,
          ...(config.placeholder !== undefined && { default: config.placeholder }),
        }),
      ),
    password: (config) => wrapCancellation(() => password({ message: config.message })),
    confirm: (config) => wrapCancellation(() => confirm({ message: config.message })),
    select: (config) =>
      wrapCancellation(() =>
        select({
          message: config.message,
          choices: config.options.map((o) => ({ name: o.label, value: o.value })),
        }),
      ),
    isCancelled: (value) => value === cancelSymbol,
  };
}

/**
 * Prompt resolver backed by @inquirer/prompts.
 *
 * @example
 * ```ts
 * import { runMain, defineCommand } from "politty";
 * import { prompt } from "politty/prompt/inquirer";
 *
 * runMain(cmd, { version: "1.0.0", prompt });
 * ```
 */
export const prompt: PromptResolver = (rawArgs, extracted) =>
  promptMissingArgs(rawArgs, extracted, { adapter: createInquirerAdapter() });
