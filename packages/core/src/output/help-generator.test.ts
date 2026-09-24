import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { extractFields } from "../core/schema-extractor.js";
import { lazy } from "../lazy.js";
import {
  generateHelp,
  generateHelpData,
  renderOptions,
  renderUsageLine,
} from "./help-generator.js";

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

    it("should render <command> when subcommands exist and no run", () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("<command>");
      expect(result).not.toContain("[command]");
    });

    it("should render [command] when subcommands exist and run is defined", () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
        run: () => {},
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("[command]");
      expect(result).not.toContain("<command>");
    });

    it("should render [command] when subcommands exist and defaultSubCommand is defined", () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
        defaultSubCommand: "build",
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("[command]");
      expect(result).not.toContain("<command>");
    });

    it("should render [command] when subcommands and options exist alongside defaultSubCommand", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
        defaultSubCommand: "build",
      });

      const result = renderUsageLine(cmd);

      expect(result).toContain("[options]");
      expect(result).toContain("[command]");
      expect(result).not.toContain("<command>");
    });
  });

  describe("renderOptions", () => {
    it("should render options with alias", () => {
      const cmd = defineCommand({
        name: "test-cmd",
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
        name: "test-cmd",
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
        name: "test-cmd",
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
        name: "test-cmd",
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
        subCommands: {
          sub: defineCommand({ name: "sub" }),
        },
      });

      const result = renderOptions(
        cmd,
        {
          help: "Display help",
          helpAll: "Display help including all subcommand options",
          helpJson: "Display help as JSON",
          version: "Display version",
        },
        { rootVersion: "1.0.0" },
      );

      expect(result).toContain("Display help");
      expect(result).toContain("Display help including all subcommand options");
      expect(result).toContain("Display help as JSON");
      expect(result).toContain("Display version");
    });

    it("should use default descriptions when not provided", () => {
      const cmd = defineCommand({
        name: "cli",
      });

      const result = renderOptions(cmd, {}, { rootVersion: "1.0.0" });

      expect(result).toContain("Show help");
      expect(result).toContain("Show help as JSON");
      expect(result).toContain("Show version");
    });

    it("should display visible long aliases next to the canonical flag", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          tobe: arg(z.string(), {
            alias: ["t", "to-be"],
            description: "philosophical choice",
          }),
        }),
      });

      const result = renderOptions(cmd);

      expect(result).toContain("-t");
      expect(result).toContain("--tobe");
      expect(result).toContain("--to-be");
    });

    it("should hide hiddenAlias entries from the help output", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          tobe: arg(z.string(), {
            alias: "to-be",
            hiddenAlias: ["legacy", "old"],
            description: "...",
          }),
        }),
      });

      const result = renderOptions(cmd);

      expect(result).toContain("--to-be");
      expect(result).not.toContain("--legacy");
      expect(result).not.toContain("--old");
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
      });

      const result = generateHelp(cmd, { context: { rootVersion: "1.0.0" } });

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

    it("should list positional arguments with their descriptions in an Arguments section between Usage and Options", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.object({
          input: arg(z.string(), { positional: true, description: "Input file" }),
          output: arg(z.string().optional(), { positional: true, description: "Output file" }),
          verbose: arg(z.boolean().default(false), {}),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toMatch(/Arguments:\n {2}<input> +Input file\n {2}\[output\] +Output file\n/);
      expect(result.indexOf("Usage:")).toBeLessThan(result.indexOf("Arguments:"));
      expect(result.indexOf("Arguments:")).toBeLessThan(result.indexOf("Options:"));
    });

    it("should list a positional argument without a description by name only", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.object({
          file: arg(z.string(), { positional: true }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toMatch(/Arguments:\n {2}<file>\n/);
    });

    it("should show the default value of a positional argument like an option's", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.object({
          target: arg(z.string().default("dist"), { positional: true, description: "Target" }),
          mode: arg(z.string().default("fast"), { positional: true }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toMatch(
        /Arguments:\n {2}\[target\] +Target \(default: "dist"\)\n {2}\[mode\] +\(default: "fast"\)\n/,
      );
    });

    it("should group variant-specific positional arguments under their discriminator value like options", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.discriminatedUnion("action", [
          z
            .object({
              action: z.literal("create"),
              target: arg(z.string(), { positional: true, description: "Target" }),
              name: arg(z.string(), { positional: true, description: "Name to create" }),
            })
            .describe("Create"),
          z.object({
            action: z.literal("delete"),
            target: arg(z.string(), { positional: true, description: "Target" }),
            id: arg(z.string().optional(), { positional: true, description: "Id to delete" }),
          }),
        ]),
      });

      const result = generateHelp(cmd, {});

      expect(result).toMatch(
        /Arguments:\n {2}<target> +Target\n\nWhen action=create: Create\n {4}<name> +Name to create\n\nWhen action=delete:\n {4}\[id\] +Id to delete\n\nOptions:/,
      );
    });

    it("should list a positional discriminator once as a common argument", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.discriminatedUnion("action", [
          z.object({
            action: arg(z.literal("create"), { positional: true, description: "Action" }),
            name: arg(z.string(), { positional: true, description: "Name" }),
          }),
          z.object({
            action: arg(z.literal("delete"), { positional: true, description: "Action" }),
            id: arg(z.string(), { positional: true, description: "Id" }),
          }),
        ]),
      });

      const result = generateHelp(cmd, {});

      expect(result).toMatch(
        /Arguments:\n {2}<action> +Action\n\nWhen action=create:\n {4}<name> +Name\n\nWhen action=delete:\n {4}<id> +Id\n\nOptions:/,
      );
    });

    it("should not list a positional discriminator as an option", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.discriminatedUnion("action", [
          z.object({ action: arg(z.literal("create"), { positional: true }) }),
          z.object({ action: arg(z.literal("delete"), { positional: true }) }),
        ]),
      });

      const result = generateHelp(cmd, {});

      expect(result).not.toContain("--action");
    });

    it("should group option-specific positional arguments under their union option label like options", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.union([
          z
            .object({ path: arg(z.string(), { positional: true, description: "Input file" }) })
            .describe("File Mode"),
          z.object({ verbose: arg(z.boolean().default(false), {}) }),
          z.object({ url: arg(z.string(), { positional: true, description: "Input URL" }) }),
        ]),
      });

      const result = generateHelp(cmd, {});

      expect(result).toMatch(
        /Arguments:\n\n {2}File Mode:\n {4}<path> +Input file\n\n {2}Variant 3:\n {4}<url> +Input URL\n\nOptions:/,
      );
    });

    it("should omit the Arguments section when the command has no positional arguments", () => {
      const cmd = defineCommand({
        name: "my-cli",
        args: z.object({
          verbose: arg(z.boolean().default(false), {}),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).not.toContain("Arguments:");
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

    it("should always include --help-json option", () => {
      const cmd = defineCommand({
        name: "my-cli",
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("--help-json");
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

    it("should render xor (exclusive union) options same as union", () => {
      const cmd = defineCommand({
        name: "xor-cmd",
        args: z.xor([
          z
            .object({
              token: arg(z.string(), { description: "API Token" }),
            })
            .describe("Token Auth"),
          z
            .object({
              username: arg(z.string(), { description: "Username" }),
              password: arg(z.string(), { description: "Password" }),
            })
            .describe("Credentials Auth"),
        ]),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("Token Auth:");
      expect(result).toContain("--token");
      expect(result).toContain("Credentials Auth:");
      expect(result).toContain("--username");
      expect(result).toContain("--password");
    });

    it("should render xor variant with no fields using dim text", () => {
      const cmd = defineCommand({
        name: "xor-empty",
        args: z.xor([
          z.object({}).strict().describe("Without Name"),
          z
            .object({ name: arg(z.string(), { description: "Name" }) })
            .strict()
            .describe("With Name"),
        ]),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("Without Name:");
      expect(result).toContain("no options");
      expect(result).toContain("With Name:");
      expect(result).toContain("--name");
    });
  });

  describe("Kebab-case display", () => {
    it("should display camelCase options in kebab-case", () => {
      const cmd = defineCommand({
        name: "kebab-cmd",
        args: z.object({
          dryRun: arg(z.boolean().default(false), { description: "Dry run mode" }),
          outputDir: arg(z.string(), { description: "Output directory" }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("--dry-run");
      expect(result).toContain("--output-dir");
      // Should not contain camelCase in flags
      expect(result).not.toContain("--dryRun");
      expect(result).not.toContain("--outputDir");
    });

    it("should display placeholder in kebab-case", () => {
      const cmd = defineCommand({
        name: "kebab-cmd",
        args: z.object({
          outputDir: arg(z.string(), { description: "Output directory" }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("<OUTPUT-DIR>");
    });
  });

  describe("Environment variable display", () => {
    it("should display single env var in help", () => {
      const cmd = defineCommand({
        name: "env-cmd",
        args: z.object({
          port: arg(z.coerce.number(), { env: "PORT", description: "Server port" }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("[env: PORT]");
    });

    it("should display multiple env vars in help", () => {
      const cmd = defineCommand({
        name: "env-cmd",
        args: z.object({
          port: arg(z.coerce.number(), {
            env: ["PORT", "SERVER_PORT"],
            description: "Server port",
          }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("[env: PORT, SERVER_PORT]");
    });

    it("should display env var with kebab-case option", () => {
      const cmd = defineCommand({
        name: "env-cmd",
        args: z.object({
          outputDir: arg(z.string(), { env: "OUTPUT_DIR", description: "Output directory" }),
        }),
      });

      const result = generateHelp(cmd, {});

      expect(result).toContain("--output-dir");
      expect(result).toContain("[env: OUTPUT_DIR]");
    });
  });

  describe("multi-line descriptions", () => {
    it("should indent continuation lines under the description column", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          mode: arg(z.string(), {
            alias: "m",
            description: "First line of description\nSecond line of description",
          }),
        }),
      });

      const result = renderOptions(cmd);
      const lines = result.split("\n");

      const firstIdx = lines.findIndex((l) => l.includes("First line of description"));
      expect(firstIdx).toBeGreaterThanOrEqual(0);

      const firstLine = lines[firstIdx]!;
      const secondLine = lines[firstIdx + 1]!;

      // The continuation line carries only the description text, no flags.
      expect(secondLine).toContain("Second line of description");
      expect(secondLine).not.toContain("--mode");

      // Both description fragments start at the same visual column.
      const firstCol = firstLine.indexOf("First line of description");
      const secondCol = secondLine.indexOf("Second line of description");
      expect(secondCol).toBe(firstCol);
    });

    it("should keep suffixes on the last description line", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          port: arg(z.number().default(8080), {
            description: "Line one\nLine two",
          }),
        }),
      });

      const result = renderOptions(cmd);
      const lines = result.split("\n");
      const secondIdx = lines.findIndex((l) => l.includes("Line two"));

      // The (default: ...) suffix is appended after the final line, not the first.
      expect(lines[secondIdx]).toContain("default");
      expect(lines[secondIdx - 1]).not.toContain("default");
    });
  });

  describe("generateHelpData", () => {
    it("should serialize name, description, positionals, and options", () => {
      const cmd = defineCommand({
        name: "greet",
        description: "A CLI tool that displays greetings",
        args: z.object({
          name: arg(z.string(), { positional: true, description: "Name of the person" }),
          loud: arg(z.boolean().default(false), { alias: "l", description: "Output in uppercase" }),
        }),
      });

      const data = generateHelpData(cmd);

      expect(data.name).toBe("greet");
      expect(data.description).toBe("A CLI tool that displays greetings");
      expect(data.positionals).toEqual([
        {
          name: "name",
          cliName: "name",
          positional: true,
          required: true,
          type: "string",
          description: "Name of the person",
        },
      ]);
      expect(data.options).toEqual([
        {
          name: "loud",
          cliName: "loud",
          positional: false,
          required: false,
          type: "boolean",
          alias: ["l"],
          description: "Output in uppercase",
          defaultValue: false,
        },
      ]);
    });

    it("should keep defaultValue as its raw type, not a JSON string", () => {
      const cmd = defineCommand({
        name: "cli",
        args: z.object({
          port: arg(z.number().default(8080)),
        }),
      });

      const data = generateHelpData(cmd);

      expect(data.options[0]?.defaultValue).toBe(8080);
    });

    it("should never contain ANSI escape codes and should JSON.stringify cleanly", () => {
      const cmd = defineCommand({
        name: "cli",
        description: "desc",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose" }),
        }),
      });

      const data = generateHelpData(cmd);
      const json = JSON.stringify(data);

      // eslint-disable-next-line no-control-regex
      expect(json).not.toMatch(/\x1B\[[0-9;]*m/);
      expect(JSON.parse(json)).toEqual(data);
    });

    it("should include the raw help/help-all/help-json descriptions", () => {
      const cmd = defineCommand({ name: "cli" });

      const data = generateHelpData(cmd);

      expect(data.builtinOptions.help).toBe("Show help");
      expect(data.builtinOptions.helpAll).toBe("Show help with all subcommand options");
      expect(data.builtinOptions.helpJson).toBeTruthy();
      expect(data.builtinOptions.version).toBeUndefined();
    });

    it("should include version only when rootVersion is in context", () => {
      const cmd = defineCommand({ name: "cli" });

      const data = generateHelpData(cmd, { context: { rootVersion: "1.2.3" } });

      expect(data.builtinOptions.version).toBe("Show version");
      expect(data.version).toBe("1.2.3");
    });

    it("should split discriminated union fields into discriminator/common/variants", () => {
      const cmd = defineCommand({
        name: "resource",
        args: z.discriminatedUnion("action", [
          z.object({
            action: z.literal("create"),
            name: arg(z.string(), { description: "Resource name" }),
          }),
          z.object({
            action: z.literal("delete"),
            id: arg(z.coerce.number(), { description: "Resource ID" }),
          }),
        ]),
      });

      const data = generateHelpData(cmd);

      expect(data.schemaType).toBe("discriminatedUnion");
      expect(data.discriminator).toBe("action");
      expect(data.options.map((o) => o.name)).toEqual(["action"]);
      expect(data.variants).toEqual([
        {
          discriminatorValue: "create",
          fields: [
            {
              name: "name",
              cliName: "name",
              positional: false,
              required: true,
              type: "string",
              description: "Resource name",
            },
          ],
        },
        {
          discriminatorValue: "delete",
          fields: [
            {
              name: "id",
              cliName: "id",
              positional: false,
              required: true,
              type: "number",
              description: "Resource ID",
            },
          ],
        },
      ]);
    });

    it("should describe the discriminator field the same way the text renderer does", () => {
      const withSchemaDescription = defineCommand({
        name: "resource",
        args: z
          .discriminatedUnion("action", [
            z.object({ action: z.literal("create") }),
            z.object({ action: z.literal("delete") }),
          ])
          .describe("Action to run"),
      });
      const withNoDescription = defineCommand({
        name: "resource",
        args: z.discriminatedUnion("action", [
          z.object({ action: z.literal("create") }),
          z.object({ action: z.literal("delete") }),
        ]),
      });

      expect(generateHelpData(withSchemaDescription).options[0]?.description).toBe("Action to run");
      expect(generateHelpData(withNoDescription).options[0]?.description).toBe("Action to perform");
    });

    it("should attribute a variant-specific positional to its own variant", () => {
      const cmd = defineCommand({
        name: "resource",
        args: z.discriminatedUnion("action", [
          z.object({
            action: z.literal("create"),
            name: arg(z.string(), { positional: true, description: "Resource name" }),
          }),
          z.object({
            action: z.literal("delete"),
            id: arg(z.coerce.number(), { description: "Resource ID" }),
          }),
        ]),
      });

      const data = generateHelpData(cmd);

      expect(data.positionals.map((f) => f.name)).toEqual(["name"]);
      expect(data.variants?.[0]?.fields.map((f) => f.name)).toEqual(["name"]);
      expect(data.variants?.[0]?.fields[0]?.positional).toBe(true);
      expect(data.variants?.[1]?.fields.map((f) => f.name)).toEqual(["id"]);
    });

    it("should split union fields into common/unionOptions", () => {
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

      const data = generateHelpData(cmd);

      expect(data.schemaType).toBe("union");
      expect(data.options.map((o) => o.name)).toEqual(["mode"]);
      expect(data.unionOptions).toHaveLength(2);
      expect(data.unionOptions?.[0]?.description).toBe("File Mode");
      expect(data.unionOptions?.[0]?.fields.map((f) => f.name)).toEqual(["path"]);
      expect(data.unionOptions?.[1]?.fields.map((f) => f.name)).toEqual(["url"]);
    });

    it("should attribute an option-specific positional to its own union option", () => {
      const cmd = defineCommand({
        name: "union-cmd",
        args: z.union([
          z.object({
            mode: z.literal("file"),
            path: arg(z.string(), { positional: true, description: "Path to file" }),
          }),
          z.object({
            mode: z.literal("url"),
            url: arg(z.string(), { description: "URL to fetch" }),
          }),
        ]),
      });

      const data = generateHelpData(cmd);

      expect(data.positionals.map((f) => f.name)).toEqual(["path"]);
      expect(data.unionOptions?.[0]?.fields.map((f) => f.name)).toEqual(["path"]);
      expect(data.unionOptions?.[0]?.fields[0]?.positional).toBe(true);
      expect(data.unionOptions?.[1]?.fields.map((f) => f.name)).toEqual(["url"]);
    });

    it("should recursively resolve the full subcommand tree regardless of depth", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          config: defineCommand({
            name: "config",
            description: "Manage configuration",
            aliases: ["c"],
            subCommands: {
              get: defineCommand({
                name: "get",
                description: "Get config value",
                args: z.object({ key: arg(z.string(), { positional: true }) }),
              }),
            },
          }),
        },
      });

      const data = generateHelpData(cmd);

      expect(data.subcommands).toHaveLength(1);
      const config = data.subcommands?.[0];
      expect(config?.name).toBe("config");
      expect(config?.aliases).toEqual(["c"]);
      expect(config?.data?.description).toBe("Manage configuration");
      expect(config?.data?.commandPath).toEqual(["config"]);

      const get = config?.data?.subcommands?.[0];
      expect(get?.name).toBe("get");
      expect(get?.data?.description).toBe("Get config value");
      expect(get?.data?.commandPath).toEqual(["config", "get"]);
      expect(get?.data?.positionals[0]?.name).toBe("key");
    });

    it("should root-prefix recursive subcommand usage even without a context", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          config: defineCommand({
            name: "config",
            subCommands: {
              get: defineCommand({ name: "get" }),
            },
          }),
        },
      });

      // No `context` passed: exercises direct-API usage, as opposed to the
      // context runMain/runCommand always supply.
      const data = generateHelpData(cmd);

      const config = data.subcommands?.[0];
      expect(config?.data?.usage.commandName).toBe("my-cli config");
      const get = config?.data?.subcommands?.[0];
      expect(get?.data?.usage.commandName).toBe("my-cli config get");
    });

    it("should resolve lazy() subcommands without loading them", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          deploy: lazy(
            defineCommand({
              name: "deploy",
              description: "Deploy the application",
              args: z.object({ env: arg(z.string(), { description: "Target env" }) }),
            }),
            () => {
              throw new Error("load() should not be called for --help-json");
            },
          ),
        },
      });

      const data = generateHelpData(cmd);

      const deploy = data.subcommands?.[0];
      expect(deploy?.unresolved).toBeUndefined();
      expect(deploy?.data?.description).toBe("Deploy the application");
      expect(deploy?.data?.options.map((o) => o.name)).toEqual(["env"]);
    });

    it("should mark legacy async-factory subcommands as unresolved", () => {
      const cmd = defineCommand({
        name: "my-cli",
        subCommands: {
          // Legacy form: no synchronous metadata available.
          legacy: () => Promise.resolve(defineCommand({ name: "legacy" })),
        },
      });

      const data = generateHelpData(cmd);

      expect(data.subcommands).toEqual([{ name: "legacy", unresolved: true }]);
    });

    it("should include global options from context", () => {
      const cmd = defineCommand({ name: "cli" });
      const globalExtracted = extractFields(
        z.object({ verbose: arg(z.boolean().default(false), { alias: "v" }) }),
      );

      const data = generateHelpData(cmd, { context: { globalExtracted } });

      expect(data.globalOptions?.map((o) => o.name)).toEqual(["verbose"]);
    });

    it("should carry notes as raw markdown, not rendered", () => {
      const cmd = defineCommand({
        name: "cli",
        notes: "See **bold** text",
      });

      const data = generateHelpData(cmd);

      expect(data.notes).toBe("See **bold** text");
    });

    it("should reflect subcommand-required vs subcommand-optional in usage", () => {
      const parentOnly = defineCommand({
        name: "cli",
        subCommands: { build: defineCommand({ name: "build" }) },
      });
      const runnableParent = defineCommand({
        name: "cli",
        subCommands: { build: defineCommand({ name: "build" }) },
        run: () => {},
      });

      expect(generateHelpData(parentOnly).usage.subcommand).toBe("required");
      expect(generateHelpData(runnableParent).usage.subcommand).toBe("optional");
    });
  });
});
