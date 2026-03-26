import { describe, expect, it } from "vitest";
import type { ResolvedFieldMeta } from "../core/schema-extractor.js";
import { getFieldsToPrompt, resolvePromptConfig } from "./prompt-resolver.js";

function makeField(overrides: Partial<ResolvedFieldMeta> = {}): ResolvedFieldMeta {
  return {
    name: "testField",
    cliName: "test-field",
    positional: false,
    required: true,
    type: "string",
    schema: {} as ResolvedFieldMeta["schema"],
    ...overrides,
  };
}

describe("resolvePromptConfig", () => {
  it("returns null when no prompt metadata", () => {
    const field = makeField();
    expect(resolvePromptConfig(field)).toBeNull();
  });

  it("returns null when prompt.enabled is false", () => {
    const field = makeField({ prompt: { enabled: false } });
    expect(resolvePromptConfig(field)).toBeNull();
  });

  it("uses prompt.message when provided", () => {
    const field = makeField({
      description: "Field desc",
      prompt: { message: "Custom message" },
    });
    const config = resolvePromptConfig(field)!;
    expect(config.message).toBe("Custom message");
  });

  it("falls back to description then name for message", () => {
    const withDesc = makeField({
      description: "Field desc",
      prompt: {},
    });
    expect(resolvePromptConfig(withDesc)!.message).toBe("Field desc");

    const withoutDesc = makeField({ prompt: {} });
    expect(resolvePromptConfig(withoutDesc)!.message).toBe("testField");
  });

  describe("type resolution priority", () => {
    it("1. explicit prompt.type takes highest priority", () => {
      const field = makeField({
        type: "boolean",
        enumValues: ["a", "b"],
        prompt: { type: "password" },
      });
      const config = resolvePromptConfig(field)!;
      expect(config.type).toBe("password");
    });

    it("1. maps file/directory to text", () => {
      const file = makeField({ prompt: { type: "file" } });
      expect(resolvePromptConfig(file)!.type).toBe("text");

      const dir = makeField({ prompt: { type: "directory" } });
      expect(resolvePromptConfig(dir)!.type).toBe("text");
    });

    it("2. explicit choices force select", () => {
      const field = makeField({
        type: "string",
        prompt: { choices: ["x", "y"] },
      });
      const config = resolvePromptConfig(field)!;
      expect(config.type).toBe("select");
      expect(config.choices).toEqual([
        { label: "x", value: "x" },
        { label: "y", value: "y" },
      ]);
    });

    it("2. supports object choices", () => {
      const field = makeField({
        prompt: { choices: [{ label: "Option A", value: "a" }] },
      });
      const config = resolvePromptConfig(field)!;
      expect(config.choices).toEqual([{ label: "Option A", value: "a" }]);
    });

    it("3. inherits from completion type", () => {
      const fileField = makeField({
        completion: { type: "file" },
        prompt: {},
      });
      expect(resolvePromptConfig(fileField)!.type).toBe("text");

      const dirField = makeField({
        completion: { type: "directory" },
        prompt: {},
      });
      expect(resolvePromptConfig(dirField)!.type).toBe("text");
    });

    it("4. auto-detects enum -> select", () => {
      const field = makeField({
        enumValues: ["debug", "info", "warn"],
        prompt: {},
      });
      const config = resolvePromptConfig(field)!;
      expect(config.type).toBe("select");
      expect(config.choices).toEqual([
        { label: "debug", value: "debug" },
        { label: "info", value: "info" },
        { label: "warn", value: "warn" },
      ]);
    });

    it("4. auto-detects boolean -> confirm", () => {
      const field = makeField({ type: "boolean", prompt: {} });
      expect(resolvePromptConfig(field)!.type).toBe("confirm");
    });

    it("4. defaults to text for string", () => {
      const field = makeField({ type: "string", prompt: {} });
      expect(resolvePromptConfig(field)!.type).toBe("text");
    });

    it("4. defaults to text for number", () => {
      const field = makeField({ type: "number", prompt: {} });
      expect(resolvePromptConfig(field)!.type).toBe("text");
    });
  });

  it("explicit choices override auto-detected enum choices", () => {
    const field = makeField({
      enumValues: ["a", "b"],
      prompt: { choices: ["x", "y", "z"] },
    });
    const config = resolvePromptConfig(field)!;
    expect(config.type).toBe("select");
    expect(config.choices).toEqual([
      { label: "x", value: "x" },
      { label: "y", value: "y" },
      { label: "z", value: "z" },
    ]);
  });
});

describe("getFieldsToPrompt", () => {
  it("returns only fields with missing values and prompt metadata", () => {
    const fields = [
      makeField({ name: "a", prompt: { message: "A?" } }),
      makeField({ name: "b", prompt: { message: "B?" } }),
      makeField({ name: "c" }), // no prompt metadata
    ];
    const rawArgs = { a: "provided" };
    const result = getFieldsToPrompt(fields, rawArgs);
    expect(result).toHaveLength(1);
    expect(result[0]!.field.name).toBe("b");
  });

  it("returns empty when all values are provided", () => {
    const fields = [makeField({ name: "a", prompt: { message: "A?" } })];
    const result = getFieldsToPrompt(fields, { a: "value" });
    expect(result).toHaveLength(0);
  });

  it("returns empty when no prompt metadata on any field", () => {
    const fields = [makeField({ name: "a" }), makeField({ name: "b" })];
    const result = getFieldsToPrompt(fields, {});
    expect(result).toHaveLength(0);
  });
});
