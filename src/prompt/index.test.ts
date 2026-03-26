import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand, runCommand } from "../index.js";
import { promptMissingArgs, withPrompt } from "./index.js";
import type { PromptAdapter } from "./types.js";

function createMockAdapter(responses: Record<string, unknown>): PromptAdapter {
  return {
    text: vi.fn(async (config): Promise<string> => (responses[config.message] as string) ?? ""),
    password: vi.fn(async (config): Promise<string> => (responses[config.message] as string) ?? ""),
    confirm: vi.fn(
      async (config): Promise<boolean> => (responses[config.message] as boolean) ?? false,
    ),
    select: vi.fn(async (config): Promise<string> => (responses[config.message] as string) ?? ""),
    isCancelled: vi.fn(() => false),
  };
}

const cancelSymbol = Symbol("cancel");

function createCancelAdapter(): PromptAdapter {
  return {
    text: vi.fn(async () => cancelSymbol),
    password: vi.fn(async () => cancelSymbol),
    confirm: vi.fn(async () => cancelSymbol),
    select: vi.fn(async () => cancelSymbol),
    isCancelled: (value) => value === cancelSymbol,
  };
}

describe("promptMissingArgs", () => {
  it("returns rawArgs unchanged in non-interactive mode", async () => {
    const rawArgs = { name: undefined };
    const extracted = {
      fields: [
        {
          name: "name",
          cliName: "name",
          positional: false,
          required: true,
          type: "string" as const,
          schema: z.string(),
          prompt: { message: "Name?" },
        },
      ],
      schema: z.object({ name: z.string() }),
      schemaType: "object" as const,
      unknownKeysMode: "strip" as const,
    };

    const result = await promptMissingArgs(rawArgs, extracted, {
      interactive: false,
    });
    expect(result).toBe(rawArgs);
  });

  it("prompts for missing values with adapter", async () => {
    const adapter = createMockAdapter({ "Name?": "Alice" });
    const extracted = {
      fields: [
        {
          name: "name",
          cliName: "name",
          positional: false,
          required: true,
          type: "string" as const,
          schema: z.string(),
          prompt: { message: "Name?" },
        },
      ],
      schema: z.object({ name: z.string() }),
      schemaType: "object" as const,
      unknownKeysMode: "strip" as const,
    };

    const result = await promptMissingArgs({}, extracted, {
      adapter,
      interactive: true,
    });
    expect(result.name).toBe("Alice");
    expect(adapter.text).toHaveBeenCalledOnce();
  });

  it("skips fields that already have values", async () => {
    const adapter = createMockAdapter({});
    const extracted = {
      fields: [
        {
          name: "name",
          cliName: "name",
          positional: false,
          required: true,
          type: "string" as const,
          schema: z.string(),
          prompt: { message: "Name?" },
        },
      ],
      schema: z.object({ name: z.string() }),
      schemaType: "object" as const,
      unknownKeysMode: "strip" as const,
    };

    const result = await promptMissingArgs({ name: "provided" }, extracted, {
      adapter,
      interactive: true,
    });
    expect(result.name).toBe("provided");
    expect(adapter.text).not.toHaveBeenCalled();
  });

  it("throws when user cancels", async () => {
    const adapter = createCancelAdapter();
    const extracted = {
      fields: [
        {
          name: "name",
          cliName: "name",
          positional: false,
          required: true,
          type: "string" as const,
          schema: z.string(),
          prompt: { message: "Name?" },
        },
      ],
      schema: z.object({ name: z.string() }),
      schemaType: "object" as const,
      unknownKeysMode: "strip" as const,
    };

    await expect(promptMissingArgs({}, extracted, { adapter, interactive: true })).rejects.toThrow(
      "Prompt cancelled by user",
    );
  });
});

describe("withPrompt integration", () => {
  it("prompts for missing required args and succeeds", async () => {
    const adapter = createMockAdapter({ "Your name": "Alice" });

    const cmd = defineCommand({
      name: "greet",
      args: z.object({
        name: arg(z.string(), {
          description: "Your name",
          prompt: {},
        }),
      }),
      run: ({ name }) => name,
    });

    const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: true }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("Alice");
    }
  });

  it("does not prompt when args are provided via CLI", async () => {
    const adapter = createMockAdapter({});

    const cmd = defineCommand({
      name: "greet",
      args: z.object({
        name: arg(z.string(), {
          description: "Your name",
          prompt: {},
        }),
      }),
      run: ({ name }) => name,
    });

    const result = await runCommand(
      cmd,
      ["--name", "Bob"],
      withPrompt({}, { adapter, interactive: true }),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("Bob");
    }
    expect(adapter.text).not.toHaveBeenCalled();
  });

  it("does not prompt when args are provided via env", async () => {
    const adapter = createMockAdapter({});

    const cmd = defineCommand({
      name: "greet",
      args: z.object({
        name: arg(z.string(), {
          env: "TEST_PROMPT_NAME",
          prompt: {},
        }),
      }),
      run: ({ name }) => name,
    });

    process.env.TEST_PROMPT_NAME = "EnvName";
    try {
      const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: true }));

      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.result).toBe("EnvName");
      }
      expect(adapter.text).not.toHaveBeenCalled();
    } finally {
      delete process.env.TEST_PROMPT_NAME;
    }
  });

  it("uses confirm prompt for boolean fields", async () => {
    const adapter = createMockAdapter({ "Enable verbose?": true });

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        verbose: arg(z.boolean(), {
          description: "Enable verbose?",
          prompt: {},
        }),
      }),
      run: ({ verbose }) => verbose,
    });

    const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: true }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe(true);
    }
    expect(adapter.confirm).toHaveBeenCalledOnce();
  });

  it("uses select prompt for enum fields", async () => {
    const adapter = createMockAdapter({ "Log level": "warn" });

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        level: arg(z.enum(["debug", "info", "warn", "error"]), {
          description: "Log level",
          prompt: {},
        }),
      }),
      run: ({ level }) => level,
    });

    const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: true }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("warn");
    }
    expect(adapter.select).toHaveBeenCalledOnce();
  });

  it("uses password prompt when type is password", async () => {
    const adapter = createMockAdapter({ "Enter token": "secret123" });

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        token: arg(z.string(), {
          prompt: { type: "password", message: "Enter token" },
        }),
      }),
      run: ({ token }) => token,
    });

    const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: true }));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.result).toBe("secret123");
    }
    expect(adapter.password).toHaveBeenCalledOnce();
  });

  it("returns exitCode 1 when user cancels prompt", async () => {
    const adapter = createCancelAdapter();

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: arg(z.string(), { prompt: { message: "Name?" } }),
      }),
      run: ({ name }) => name,
    });

    const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: true }));

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
  });

  it("does not prompt for fields without prompt metadata", async () => {
    const adapter = createMockAdapter({ "Name?": "Alice" });

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: arg(z.string(), { prompt: { message: "Name?" } }),
        age: z.string(), // no prompt metadata
      }),
      run: ({ name }) => name,
    });

    const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: true }));

    // Should fail because 'age' is required but not prompted
    expect(result.success).toBe(false);
  });

  it("non-interactive mode skips prompts and fails validation", async () => {
    const adapter = createMockAdapter({ "Name?": "Alice" });

    const cmd = defineCommand({
      name: "test",
      args: z.object({
        name: arg(z.string(), { prompt: { message: "Name?" } }),
      }),
      run: ({ name }) => name,
    });

    const result = await runCommand(cmd, [], withPrompt({}, { adapter, interactive: false }));

    expect(result.success).toBe(false);
    expect(adapter.text).not.toHaveBeenCalled();
  });
});
