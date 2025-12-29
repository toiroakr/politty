import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { formatCommandValidationErrors, validateCommand } from "./command-validator.js";

describe("validateCommand", () => {
  describe("single command validation", () => {
    it("should return valid for a correct command", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          name: arg(z.string(), { description: "Name" }),
          verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose mode" }),
        }),
      });

      const result = await validateCommand(cmd);
      expect(result.valid).toBe(true);
    });

    it("should return valid for command without args", async () => {
      const cmd = defineCommand({
        name: "test",
      });

      const result = await validateCommand(cmd);
      expect(result.valid).toBe(true);
    });

    it("should detect duplicate aliases", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose" }),
          version: arg(z.string(), { alias: "v", description: "Version" }),
        }),
      });

      const result = await validateCommand(cmd);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.type === "duplicate_alias")).toBe(true);
        expect(result.errors[0]?.commandPath).toEqual(["test"]);
      }
    });

    it("should detect reserved alias usage", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          // @ts-expect-error - testing error case for missing overrideBuiltinAlias
          header: arg(z.string(), { alias: "h", description: "Header" }),
        }),
      });

      const result = await validateCommand(cmd);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.type === "reserved_alias")).toBe(true);
      }
    });

    it("should detect positional config errors", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          files: arg(z.array(z.string()), { positional: true, description: "Files" }),
          output: arg(z.string(), { positional: true, description: "Output" }),
        }),
      });

      const result = await validateCommand(cmd);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.some((e) => e.type === "positional_config")).toBe(true);
      }
    });
  });

  describe("recursive subcommand validation", () => {
    it("should validate nested subcommands", async () => {
      const invalidSubCmd = defineCommand({
        name: "invalid",
        args: z.object({
          a: arg(z.string(), { alias: "x", description: "A" }),
          b: arg(z.string(), { alias: "x", description: "B" }), // duplicate alias
        }),
      });

      const parentCmd = defineCommand({
        name: "parent",
        subCommands: { invalid: invalidSubCmd },
      });

      const result = await validateCommand(parentCmd);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]?.commandPath).toEqual(["parent", "invalid"]);
      }
    });

    it("should handle lazy-loaded subcommands", async () => {
      const lazySubCmd = async () =>
        defineCommand({
          name: "lazy",
          args: z.object({
            dup: arg(z.string(), { alias: "d", description: "Dup" }),
            dup2: arg(z.string(), { alias: "d", description: "Dup2" }), // duplicate
          }),
        });

      const parentCmd = defineCommand({
        name: "parent",
        subCommands: { lazy: lazySubCmd },
      });

      const result = await validateCommand(parentCmd);
      expect(result.valid).toBe(false);
    });

    it("should collect errors from multiple subcommands", async () => {
      const sub1 = defineCommand({
        name: "sub1",
        args: z.object({
          // @ts-expect-error - testing error case
          h: arg(z.string(), { alias: "h", description: "H" }),
        }),
      });
      const sub2 = defineCommand({
        name: "sub2",
        args: z.object({
          a: arg(z.string(), { alias: "x", description: "A" }),
          b: arg(z.string(), { alias: "x", description: "B" }),
        }),
      });

      const parent = defineCommand({
        name: "cli",
        subCommands: { sub1, sub2 },
      });

      const result = await validateCommand(parent);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
        // Check that errors come from different subcommands
        const paths = result.errors.map((e) => e.commandPath.join(" > "));
        expect(paths.some((p) => p.includes("sub1"))).toBe(true);
        expect(paths.some((p) => p.includes("sub2"))).toBe(true);
      }
    });

    it("should validate deeply nested subcommands", async () => {
      const deepInvalid = defineCommand({
        name: "deep",
        args: z.object({
          x: arg(z.string(), { alias: "a", description: "X" }),
          y: arg(z.string(), { alias: "a", description: "Y" }),
        }),
      });

      const level2 = defineCommand({
        name: "level2",
        subCommands: { deep: deepInvalid },
      });

      const level1 = defineCommand({
        name: "level1",
        subCommands: { level2 },
      });

      const root = defineCommand({
        name: "root",
        subCommands: { level1 },
      });

      const result = await validateCommand(root);
      expect(result.valid).toBe(false);
      if (!result.valid) {
        expect(result.errors[0]?.commandPath).toEqual(["root", "level1", "level2", "deep"]);
      }
    });
  });
});

describe("formatCommandValidationErrors", () => {
  it("should format empty errors", () => {
    const result = formatCommandValidationErrors([]);
    expect(result).toBe("");
  });

  it("should format single error", () => {
    const result = formatCommandValidationErrors([
      {
        commandPath: ["cli", "build"],
        type: "duplicate_alias",
        message: 'Duplicate alias "v" detected.',
        field: "verbose",
      },
    ]);

    expect(result).toContain("Command definition errors:");
    expect(result).toContain("[cli > build]");
    expect(result).toContain('Duplicate alias "v" detected.');
  });

  it("should format multiple errors", () => {
    const result = formatCommandValidationErrors([
      {
        commandPath: ["cli"],
        type: "reserved_alias",
        message: 'Alias "h" is reserved.',
      },
      {
        commandPath: ["cli", "sub"],
        type: "duplicate_alias",
        message: 'Duplicate alias "x".',
      },
    ]);

    expect(result).toContain("[cli]");
    expect(result).toContain("[cli > sub]");
  });
});
