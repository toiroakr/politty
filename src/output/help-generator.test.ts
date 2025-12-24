import { describe, it, expect } from "vitest";
import { z } from "zod";
import { renderUsageLine, renderOptions, generateHelp } from "./help-generator.js";
import { defineCommand } from "../core/command.js";
import { arg } from "../core/arg-registry.js";

/**
 * Task 6.1 & 6.2: Help generation system tests
 * - Display required args as <arg>, optional as [arg]
 * - Display aliases as -v, --verbose
 * - Auto-generate help text from command metadata
 * - Control subcommand list display
 */
describe("Help Generator", () => {
  describe("renderUsageLine", () => {
    it("should render command name in usage", () => {
      const cmd = defineCommand({
        name: "my-cli",
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("my-cli");
    });

    it("should render required positional as <arg>", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          file: arg(z.string(), { positional: true }),
        }),
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("<file>");
    });

    it("should render optional positional as [arg]", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          file: arg(z.string().optional(), { positional: true }),
        }),
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("[file]");
    });

    it("should render [options] when options exist", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("[options]");
    });

    it("should render [command] when subcommands exist", () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("[command]");
    });
  });

  describe("renderOptions", () => {
    it("should render options with alias", () => {
      const cmd = defineCommand({
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose mode",
          }),
        }),
      });

      const result = renderOptions(cmd);

      expect(result).toContain("-v");
      expect(result).toContain("--verbose");
      expect(result).toContain("Enable verbose mode");
    });

    it("should show default values", () => {
      const cmd = defineCommand({
        args: z.object({
          port: arg(z.number().default(8080), {
            description: "Port number",
          }),
        }),
      });

      const result = renderOptions(cmd);

      expect(result).toContain("8080");
      expect(result).toContain("default");
    });

    it("should mark required options", () => {
      const cmd = defineCommand({
        args: z.object({
          config: arg(z.string(), {
            description: "Config file path",
          }),
        }),
      });

      const result = renderOptions(cmd);

      expect(result).toContain("required");
    });

    it("should use placeholder in option display", () => {
      const cmd = defineCommand({
        args: z.object({
          output: arg(z.string(), {
            alias: "o",
            placeholder: "FILE",
            description: "Output file",
          }),
        }),
      });

      const result = renderOptions(cmd);

      expect(result).toContain("FILE");
    });

    it("should allow custom descriptions for built-in options", () => {
      const cmd = defineCommand({
        name: "cli",
        version: "1.0.0",
        subCommands: {
          sub: defineCommand({ name: "sub" }),
        },
      });

      const result = renderOptions(cmd, {
        help: "ヘルプを表示",
        helpAll: "すべてのサブコマンドオプションを含むヘルプを表示",
        version: "バージョンを表示",
      });

      expect(result).toContain("ヘルプを表示");
      expect(result).toContain("すべてのサブコマンドオプションを含むヘルプを表示");
      expect(result).toContain("バージョンを表示");
    });

    it("should use default descriptions when not provided", () => {
      const cmd = defineCommand({
        name: "cli",
        version: "1.0.0",
      });

      const result = renderOptions(cmd);

      expect(result).toContain("Show help");
      expect(result).toContain("Show version");
    });
  });

  describe("generateHelp", () => {
    it("should include description", () => {
      const cmd = defineCommand({
        name: "my-cli",
        description: "A test CLI application",
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("A test CLI application");
    });

    it("should include version", () => {
      const cmd = defineCommand({
        name: "my-cli",
        version: "1.0.0",
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("1.0.0");
    });

    it("should include usage section", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.object({
          file: arg(z.string(), { positional: true }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("Usage:");
      expect(result).toContain("my-cli");
    });

    it("should include options section", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("Options:");
      expect(result).toContain("--verbose");
    });

    it("should include subcommands when showSubcommands is true", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
          }),
          test: defineCommand({
            name: "test",
            description: "Run tests",
          }),
        },
      });

      const result = generateHelp(cmd, { showSubcommands: true });

      expect(result).toContain("Commands:");
      expect(result).toContain("build");
      expect(result).toContain("test");
    });

    it("should hide subcommands when showSubcommands is false", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      const result = generateHelp(cmd, { showSubcommands: false });

      expect(result).not.toContain("Commands:");
    });

    it("should always include --help option", () => {
      const cmd = defineCommand({
        name: "my-cli",
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("--help");
      expect(result).toContain("-h");
    });

    it("should show subcommand options when showSubcommandOptions is true", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
              minify: arg(z.boolean().default(false), {
                alias: "m",
                description: "Minify output",
              }),
            }),
          }),
        },
      });

      const result = generateHelp(cmd, { showSubcommandOptions: true });

      expect(result).toContain("Commands:");
      expect(result).toContain("build");
      expect(result).toContain("--output");
      expect(result).toContain("--minify");
      expect(result).toContain("Output directory");
    });

    it("should not show subcommand options when showSubcommandOptions is false", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          build: defineCommand({
            name: "build",
            description: "Build the project",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
            }),
          }),
        },
      });

      const result = generateHelp(cmd, { showSubcommandOptions: false });

      expect(result).toContain("Commands:");
      expect(result).toContain("build");
      expect(result).not.toContain("--output");
    });

    it("should show nested subcommand options recursively", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          config: defineCommand({
            name: "config",
            description: "Manage configuration",
            subCommands: {
              get: defineCommand({
                name: "get",
                description: "Get config value",
                args: z.object({
                  key: arg(z.string(), {
                    positional: true,
                    description: "Config key",
                  }),
                }),
              }),
              set: defineCommand({
                name: "set",
                description: "Set config value",
                args: z.object({
                  key: arg(z.string(), { positional: true }),
                  value: arg(z.string(), { positional: true }),
                }),
              }),
            },
          }),
        },
      });

      const result = generateHelp(cmd, { showSubcommandOptions: true });

      expect(result).toContain("config");
      expect(result).toContain("config get");
      expect(result).toContain("config set");
      expect(result).toContain("Get config value");
      expect(result).toContain("Set config value");
    });
    it("should render union options separately with correct labels", () => {
      const cmd = defineCommand({
        name: "union-cmd",
        args: z.union([
          z
            .object({
              mode: z.literal("file"),
              path: arg(z.string(), { description: "Path to file" }),
            })
            .describe("File Mode"),
          z.object({
            mode: z.literal("url"),
            url: arg(z.string(), { description: "URL to fetch" }),
          }),
        ]),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("File Mode:");
      expect(result).toContain("--path");
      expect(result).toContain("Variant 2:");
      expect(result).toContain("--url");
      expect(result).toContain("--mode");
    });
  });
});
