import type * as InquirerPrompts from "@inquirer/prompts";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand, runCommand } from "../../index.js";
import { prompt } from "./index.js";

vi.mock("@inquirer/prompts", async (importOriginal) => ({
  ...(await importOriginal<typeof InquirerPrompts>()),
  // Mirrors @inquirer/input submitting an empty line: it resolves to `default`.
  input: vi.fn(async (config: { default?: string | undefined }) => config.default ?? ""),
}));

describe("inquirer prompt", () => {
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

  it("does not submit the help placeholder when text input is left empty", async () => {
    const cmd = defineCommand({
      name: "cat",
      args: z.object({
        file: arg(z.string(), { positional: true, placeholder: "FILE", prompt: {} }),
      }),
      run: ({ file }) => file,
    });

    const result = await runCommand(cmd, [], { prompt });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("");
    }
  });
});
