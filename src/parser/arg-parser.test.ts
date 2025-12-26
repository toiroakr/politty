import { describe, it, expect } from "vitest";
import { z } from "zod";
import { parseArgs } from "./arg-parser.js";
import { defineCommand } from "../core/command.js";
import { arg } from "../core/arg-registry.js";
import { PositionalConfigError } from "../core/schema-extractor.js";

/**
 * Task 4.2: Argument parser tests
 * - Map positional arguments to defined names
 * - Detect --help / -h flags
 * - Extract subcommand names
 * - Detect unknown options
 */
describe("ArgParser", () => {
  describe("parseArgs", () => {
    it("should detect help flag (--help)", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          name: z.string(),
        }),
      });

      const result = parseArgs(["--help"], cmd);

      expect(result.helpRequested).toBe(true);
    });

    it("should detect help flag (-h)", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          name: z.string(),
        }),
      });

      const result = parseArgs(["-h"], cmd);

      expect(result.helpRequested).toBe(true);
    });

    it("should detect --help-all flag", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          name: z.string(),
        }),
      });

      const result = parseArgs(["--help-all"], cmd);

      expect(result.helpAllRequested).toBe(true);
      expect(result.helpRequested).toBe(false);
    });

    it("should detect -H flag as help-all when command has subcommands", () => {
      const subCmd = defineCommand({ name: "build" });
      const cmd = defineCommand({
        name: "cli",
        subCommands: { build: subCmd },
      });

      const result = parseArgs(["-H"], cmd);

      expect(result.helpAllRequested).toBe(true);
      expect(result.helpRequested).toBe(false);
    });

    it("should allow user to use -H alias and override --help-all", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          host: arg(z.string(), { alias: "H", overrideBuiltinAlias: true }),
        }),
      });

      const result = parseArgs(["-H", "localhost"], cmd);

      expect(result.helpAllRequested).toBe(false);
      expect(result.rawArgs.host).toBe("localhost");
    });

    it("should throw error when -h alias is used without override flag", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          // @ts-expect-error - testing error case for missing overrideBuiltinAlias
          header: arg(z.string(), { alias: "h" }),
        }),
      });

      expect(() => parseArgs(["--help"], cmd)).toThrow(
        'Alias "h" is reserved for --help. To override this, set { alias: "h", overrideBuiltinAlias: true }',
      );
    });

    it("should prioritize subcommand over --help-all", () => {
      const subCmd = defineCommand({ name: "build" });
      const cmd = defineCommand({
        name: "cli",
        subCommands: { build: subCmd },
      });

      const result = parseArgs(["build", "--help-all"], cmd);

      expect(result.subCommand).toBe("build");
      expect(result.remainingArgs).toEqual(["--help-all"]);
    });

    it("should map positional arguments to defined names", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string(), { positional: true }),
        }),
      });

      const result = parseArgs(["file1.txt", "file2.txt"], cmd);

      expect(result.rawArgs.input).toBe("file1.txt");
      expect(result.rawArgs.output).toBe("file2.txt");
      expect(result.positionals).toEqual(["file1.txt", "file2.txt"]);
    });

    it("should extract subcommand name", () => {
      const subCmd = defineCommand({ name: "build" });
      const cmd = defineCommand({
        name: "cli",
        subCommands: { build: subCmd },
      });

      const result = parseArgs(["build", "--verbose"], cmd);

      expect(result.subCommand).toBe("build");
    });

    it("should extract remaining args after subcommand", () => {
      const subCmd = defineCommand({
        name: "build",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
      });
      const cmd = defineCommand({
        name: "cli",
        subCommands: { build: subCmd },
      });

      const result = parseArgs(["build", "--verbose"], cmd);

      expect(result.subCommand).toBe("build");
      expect(result.remainingArgs).toEqual(["--verbose"]);
    });

    it("should detect unknown flags", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
      });

      const result = parseArgs(["--verbose", "--unknown-flag"], cmd);

      // unknownFlags stores the flag name without the -- prefix
      expect(result.unknownFlags).toContain("unknown-flag");
    });

    it("should parse named options", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          output: arg(z.string(), { alias: "o" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
      });

      const result = parseArgs(["-o", "out.txt", "-v"], cmd);

      expect(result.rawArgs.output).toBe("out.txt");
      expect(result.rawArgs.verbose).toBe(true);
    });

    it("should handle mixed positional and named args", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          file: arg(z.string(), { positional: true }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
          output: arg(z.string(), { alias: "o" }),
        }),
      });

      const result = parseArgs(["input.txt", "-v", "-o", "output.txt"], cmd);

      expect(result.rawArgs.file).toBe("input.txt");
      expect(result.rawArgs.verbose).toBe(true);
      expect(result.rawArgs.output).toBe("output.txt");
    });

    it("should handle version flag (--version)", () => {
      const cmd = defineCommand({
        name: "test-cmd",
      });

      const result = parseArgs(["--version"], cmd);

      expect(result.versionRequested).toBe(true);
    });

    it("should return empty subCommand when no subcommands defined", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          verbose: z.boolean().default(false),
        }),
      });

      const result = parseArgs(["arg1"], cmd);

      expect(result.subCommand).toBeUndefined();
    });
  });

  describe("Multiple positional arguments", () => {
    it("should map multiple positionals in definition order", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          src: arg(z.string(), { positional: true }),
          dest: arg(z.string(), { positional: true }),
        }),
      });

      const result = parseArgs(["input.txt", "output.txt"], cmd);

      expect(result.rawArgs.src).toBe("input.txt");
      expect(result.rawArgs.dest).toBe("output.txt");
      expect(result.positionals).toEqual(["input.txt", "output.txt"]);
    });

    it("should handle optional positional at the end", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string().optional(), { positional: true }),
        }),
      });

      // With both positionals
      const result1 = parseArgs(["in.txt", "out.txt"], cmd);
      expect(result1.rawArgs.input).toBe("in.txt");
      expect(result1.rawArgs.output).toBe("out.txt");

      // With only required positional
      const result2 = parseArgs(["in.txt"], cmd);
      expect(result2.rawArgs.input).toBe("in.txt");
      expect(result2.rawArgs.output).toBeUndefined();
    });

    it("should handle three or more positionals", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          action: arg(z.string(), { positional: true }),
          source: arg(z.string(), { positional: true }),
          target: arg(z.string(), { positional: true }),
        }),
      });

      const result = parseArgs(["copy", "/from/path", "/to/path"], cmd);

      expect(result.rawArgs.action).toBe("copy");
      expect(result.rawArgs.source).toBe("/from/path");
      expect(result.rawArgs.target).toBe("/to/path");
    });

    it("should handle mixed positionals and named options", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string(), { positional: true }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
          format: arg(z.string().default("json"), { alias: "f" }),
        }),
      });

      const result = parseArgs(["in.txt", "-v", "out.txt", "-f", "yaml"], cmd);

      expect(result.rawArgs.input).toBe("in.txt");
      expect(result.rawArgs.output).toBe("out.txt");
      expect(result.rawArgs.verbose).toBe(true);
      expect(result.rawArgs.format).toBe("yaml");
    });

    it("should handle fewer positionals than defined", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          first: arg(z.string(), { positional: true }),
          second: arg(z.string(), { positional: true }),
          third: arg(z.string(), { positional: true }),
        }),
      });

      const result = parseArgs(["only-one"], cmd);

      expect(result.rawArgs.first).toBe("only-one");
      expect(result.rawArgs.second).toBeUndefined();
      expect(result.rawArgs.third).toBeUndefined();
    });

    it("should throw error when positional follows array positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          files: arg(z.array(z.string()), { positional: true }),
          output: arg(z.string(), { positional: true }),
        }),
      });

      expect(() => parseArgs(["a.txt", "b.txt", "out.txt"], cmd)).toThrow(PositionalConfigError);
      expect(() => parseArgs(["a.txt", "b.txt", "out.txt"], cmd)).toThrow(
        /output.*cannot follow.*files/,
      );
    });

    it("should throw error when multiple positionals follow array positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          items: arg(z.array(z.string()), { positional: true }),
          target: arg(z.string(), { positional: true }),
          mode: arg(z.string(), { positional: true }),
        }),
      });

      expect(() => parseArgs([], cmd)).toThrow(PositionalConfigError);
      expect(() => parseArgs([], cmd)).toThrow(/target.*cannot follow.*items/);
    });

    it("should allow array positional as the last positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          command: arg(z.string(), { positional: true }),
          files: arg(z.array(z.string()), { positional: true }),
        }),
      });

      // Should not throw
      const result = parseArgs(["build", "a.txt", "b.txt"], cmd);

      expect(result.rawArgs.command).toBe("build");
      expect(result.rawArgs.files).toEqual(["a.txt", "b.txt"]);
    });

    it("should allow single array positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          files: arg(z.array(z.string()), { positional: true }),
        }),
      });

      // Should not throw
      const result = parseArgs(["a.txt", "b.txt", "c.txt"], cmd);

      expect(result.rawArgs.files).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("should throw error when required positional follows optional positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          optional: arg(z.string().optional(), { positional: true }),
          required: arg(z.string(), { positional: true }),
        }),
      });

      expect(() => parseArgs(["value1", "value2"], cmd)).toThrow(PositionalConfigError);
      expect(() => parseArgs(["value1", "value2"], cmd)).toThrow(
        /required.*cannot follow.*optional/,
      );
    });

    it("should throw error when multiple required follow optional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          first: arg(z.string().optional(), { positional: true }),
          second: arg(z.string(), { positional: true }),
          third: arg(z.string(), { positional: true }),
        }),
      });

      expect(() => parseArgs([], cmd)).toThrow(PositionalConfigError);
      expect(() => parseArgs([], cmd)).toThrow(/second.*cannot follow.*first/);
    });

    it("should allow optional positional at the end", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          required1: arg(z.string(), { positional: true }),
          required2: arg(z.string(), { positional: true }),
          optional: arg(z.string().optional(), { positional: true }),
        }),
      });

      // Should not throw
      const result = parseArgs(["a", "b", "c"], cmd);

      expect(result.rawArgs.required1).toBe("a");
      expect(result.rawArgs.required2).toBe("b");
      expect(result.rawArgs.optional).toBe("c");
    });

    it("should allow multiple optional positionals at the end", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          required: arg(z.string(), { positional: true }),
          optional1: arg(z.string().optional(), { positional: true }),
          optional2: arg(z.string().optional(), { positional: true }),
        }),
      });

      // Should not throw
      const result = parseArgs(["a", "b"], cmd);

      expect(result.rawArgs.required).toBe("a");
      expect(result.rawArgs.optional1).toBe("b");
      expect(result.rawArgs.optional2).toBeUndefined();
    });

    it("should allow all optional positionals", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          first: arg(z.string().optional(), { positional: true }),
          second: arg(z.string().optional(), { positional: true }),
        }),
      });

      // Should not throw
      const result = parseArgs(["only-one"], cmd);

      expect(result.rawArgs.first).toBe("only-one");
      expect(result.rawArgs.second).toBeUndefined();
    });

    it("should handle default values as optional positionals", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          input: arg(z.string(), { positional: true }),
          output: arg(z.string().default("out.txt"), { positional: true }),
        }),
      });

      // Should not throw - default values make positional optional
      const result = parseArgs(["in.txt"], cmd);

      expect(result.rawArgs.input).toBe("in.txt");
      expect(result.rawArgs.output).toBeUndefined(); // Will get default via Zod validation
    });

    it("should throw error when array positional follows optional positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          optional: arg(z.string().optional(), { positional: true }),
          files: arg(z.array(z.string()), { positional: true }),
        }),
      });

      expect(() => parseArgs([], cmd)).toThrow(PositionalConfigError);
      expect(() => parseArgs([], cmd)).toThrow(/files.*cannot be used with.*optional/);
    });

    it("should throw error when array positional follows default positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          mode: arg(z.string().default("default"), { positional: true }),
          files: arg(z.array(z.string()), { positional: true }),
        }),
      });

      expect(() => parseArgs([], cmd)).toThrow(PositionalConfigError);
      expect(() => parseArgs([], cmd)).toThrow(/files.*cannot be used with.*mode/);
    });

    it("should allow required positionals before array positional", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          command: arg(z.string(), { positional: true }),
          target: arg(z.string(), { positional: true }),
          files: arg(z.array(z.string()), { positional: true }),
        }),
      });

      // Should not throw - all positionals before array are required
      const result = parseArgs(["build", "app", "a.ts", "b.ts"], cmd);

      expect(result.rawArgs.command).toBe("build");
      expect(result.rawArgs.target).toBe("app");
      expect(result.rawArgs.files).toEqual(["a.ts", "b.ts"]);
    });
  });

  describe("Array arguments", () => {
    it("should accumulate multiple values for array flag", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          files: arg(z.array(z.string()), { description: "Input files" }),
        }),
      });

      const result = parseArgs(["--files", "a.txt", "--files", "b.txt", "--files", "c.txt"], cmd);

      expect(result.rawArgs.files).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("should accumulate array values with alias", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          include: arg(z.array(z.string()), { alias: "I", description: "Include paths" }),
        }),
      });

      const result = parseArgs(["-I", "src", "-I", "lib", "--include", "tests"], cmd);

      expect(result.rawArgs.include).toEqual(["src", "lib", "tests"]);
    });

    it("should handle single value for array flag", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          tags: arg(z.array(z.string()).default([]), { alias: "t" }),
        }),
      });

      const result = parseArgs(["--tags", "important"], cmd);

      expect(result.rawArgs.tags).toEqual(["important"]);
    });

    it("should handle array flag with = syntax", () => {
      const cmd = defineCommand({
        name: "test-cmd",
        args: z.object({
          exclude: arg(z.array(z.string()), { description: "Exclude patterns" }),
        }),
      });

      const result = parseArgs(["--exclude=node_modules", "--exclude=dist"], cmd);

      expect(result.rawArgs.exclude).toEqual(["node_modules", "dist"]);
    });
  });
});
