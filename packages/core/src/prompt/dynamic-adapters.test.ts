import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { PromptChoicesContext } from "../core/arg-registry.js";
import { arg, defineCommand, runCommand } from "../index.js";
import { prompt as clack } from "./clack/index.js";
import { prompt as inquirer } from "./inquirer/index.js";

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(async ({ options }) => options[0].value),
  isCancel: () => false,
}));
vi.mock("@inquirer/prompts", () => ({
  input: vi.fn(),
  password: vi.fn(),
  confirm: vi.fn(),
  select: vi.fn(async ({ choices }) => choices[0].value),
}));

describe.each([
  { name: "clack", prompt: clack },
  { name: "inquirer", prompt: inquirer },
])("$name dynamic choices", ({ prompt }) => {
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;

  beforeEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    vi.stubEnv("CI", "");
    vi.stubEnv("POLITTY_NO_PROMPT", "");
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdin, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdout, configurable: true });
    vi.unstubAllEnvs();
  });

  it("passes earlier global answers to global choices and validated globals to command choices", async () => {
    const globalChoices = vi.fn(async ({ rawArgs, globalArgs }: PromptChoicesContext) => {
      expect(rawArgs).toMatchObject({ org: "acme" });
      expect(globalArgs).toMatchObject({ org: "acme" });
      return ["prod"];
    });
    const localChoices = vi.fn(async ({ globalArgs }: PromptChoicesContext) => {
      expect(globalArgs).toEqual({ org: "acme", environment: "prod", retries: 3 });
      return [{ label: "API", value: "api" }];
    });
    const cmd = defineCommand({
      name: "deploy",
      args: z.object({ project: arg(z.string(), { prompt: { choices: localChoices } }) }),
      run: ({ project }) => project,
    });
    const result = await runCommand(cmd, [], {
      globalArgs: z.object({
        org: arg(z.string(), { prompt: { choices: async () => ["acme"] } }),
        environment: arg(z.string(), { prompt: { choices: globalChoices } }),
        retries: z.number().default(3),
      }),
      prompt,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.result).toBe("api");
    expect(globalChoices).toHaveBeenCalledOnce();
    expect(localChoices).toHaveBeenCalledOnce();
  });
});
