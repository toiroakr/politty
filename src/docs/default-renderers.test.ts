import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg, defineCommand } from "../index.js";
import {
  createCommandRenderer,
  defaultRenderers,
  renderArgumentsTable,
  renderOptionsTable,
  renderSubcommandsTable,
  renderUsage,
} from "./default-renderers.js";
import { buildCommandInfo } from "./doc-generator.js";

describe("default-renderers", () => {
  describe("renderUsage", () => {
    it("should render simple command usage", async () => {
      const cmd = defineCommand({
        name: "greet",
        description: "Greet someone",
        args: z.object({
          name: arg(z.string(), {
            positional: true,
            description: "Name to greet",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "greet");
      const usage = renderUsage(info);

      expect(usage).toBe("greet <name>");
    });

    it("should render command with options and subcommands", async () => {
      const subCmd = defineCommand({
        name: "sub",
        description: "Sub command",
        run: () => {},
      });

      const cmd = defineCommand({
        name: "cli",
        description: "CLI",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Verbose",
          }),
        }),
        subCommands: { sub: subCmd },
      });

      const info = await buildCommandInfo(cmd, "cli");
      const usage = renderUsage(info);

      expect(usage).toBe("cli [options] [command]");
    });

    it("should render optional positional argument", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          file: arg(z.string().optional(), {
            positional: true,
            description: "File",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const usage = renderUsage(info);

      expect(usage).toBe("test [file]");
    });
  });

  describe("renderArgumentsTable", () => {
    it("should render arguments table", async () => {
      const cmd = defineCommand({
        name: "greet",
        args: z.object({
          name: arg(z.string(), {
            positional: true,
            description: "Name to greet",
          }),
          message: arg(z.string().optional(), {
            positional: true,
            description: "Custom message",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "greet");
      const table = renderArgumentsTable(info);

      expect(table).toContain("| Argument | Description | Required |");
      expect(table).toContain("| `name` | Name to greet | Yes |");
      expect(table).toContain("| `message` | Custom message | No |");
    });

    it("should return empty string when no positional args", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          flag: arg(z.boolean().default(false), { description: "Flag" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const table = renderArgumentsTable(info);

      expect(table).toBe("");
    });
  });

  describe("renderOptionsTable", () => {
    it("should render options table", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose mode",
          }),
          output: arg(z.string().default("dist"), {
            alias: "o",
            description: "Output directory",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const table = renderOptionsTable(info);

      expect(table).toContain("| Option | Alias | Description | Default |");
      expect(table).toContain("| `--verbose` | `-v` | Enable verbose mode | `false` |");
      expect(table).toContain('| `--output <OUTPUT>` | `-o` | Output directory | `"dist"` |');
    });

    it("should handle options without alias", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          config: arg(z.string(), { description: "Config file" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const table = renderOptionsTable(info);

      expect(table).toContain("| `--config <CONFIG>` | - | Config file | - |");
    });

    it("should display camelCase options in kebab-case", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          dryRun: arg(z.boolean().default(false), { description: "Dry run mode" }),
          outputDir: arg(z.string(), { description: "Output directory" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const table = renderOptionsTable(info);

      expect(table).toContain("--dry-run");
      expect(table).toContain("--output-dir");
      expect(table).not.toContain("--dryRun");
      expect(table).not.toContain("--outputDir");
      // Placeholder should use underscores instead of hyphens
      expect(table).toContain("<OUTPUT_DIR>");
    });

    it("should display env column when options have env configured", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          port: arg(z.coerce.number(), { env: "PORT", description: "Server port" }),
          host: arg(z.string().default("localhost"), { description: "Server host" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const table = renderOptionsTable(info);

      expect(table).toContain("| Option | Alias | Description | Default | Env |");
      expect(table).toContain("`PORT`");
      // Options without env should show "-"
      expect(table).toMatch(/host.*\| - \|$/m);
    });

    it("should display multiple env vars", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          port: arg(z.coerce.number(), {
            env: ["PORT", "SERVER_PORT"],
            description: "Server port",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const table = renderOptionsTable(info);

      expect(table).toContain("`PORT`");
      expect(table).toContain("`SERVER_PORT`");
    });
  });

  describe("renderSubcommandsTable", () => {
    it("should render subcommands table with anchors", async () => {
      const initCmd = defineCommand({
        name: "init",
        description: "Initialize project",
        run: () => {},
      });

      const buildCmd = defineCommand({
        name: "build",
        description: "Build project",
        run: () => {},
      });

      const cmd = defineCommand({
        name: "cli",
        description: "CLI tool",
        subCommands: {
          init: initCmd,
          build: buildCmd,
        },
      });

      const info = await buildCommandInfo(cmd, "cli");
      const table = renderSubcommandsTable(info, true);

      expect(table).toContain("| Command | Description |");
      expect(table).toContain("| [`init`](#init) | Initialize project |");
      expect(table).toContain("| [`build`](#build) | Build project |");
    });

    it("should render without anchors when disabled", async () => {
      const subCmd = defineCommand({
        name: "sub",
        description: "Sub command",
        run: () => {},
      });

      const cmd = defineCommand({
        name: "cli",
        subCommands: { sub: subCmd },
      });

      const info = await buildCommandInfo(cmd, "cli");
      const table = renderSubcommandsTable(info, false);

      expect(table).toContain("| `sub` | Sub command |");
      expect(table).not.toContain("#sub");
    });
  });

  describe("createCommandRenderer", () => {
    it("should render complete command documentation", async () => {
      const cmd = defineCommand({
        name: "greet",
        description: "Greet someone",
        args: z.object({
          name: arg(z.string(), {
            positional: true,
            description: "Name to greet",
          }),
          greeting: arg(z.string().default("Hello"), {
            alias: "g",
            description: "Greeting phrase",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "greet");
      const renderer = createCommandRenderer();
      const markdown = renderer(info);

      expect(markdown).toContain("# greet");
      expect(markdown).toContain("Greet someone");
      expect(markdown).toContain("## Usage");
      expect(markdown).toContain("greet [options] <name>");
      expect(markdown).toContain("## Arguments");
      expect(markdown).toContain("## Options");
    });

    it("should use custom heading level", async () => {
      const cmd = defineCommand({
        name: "test",
        description: "Test",
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({ headingLevel: 2 });
      const markdown = renderer(info);

      expect(markdown).toContain("## test");
      expect(markdown).toContain("### Usage");
    });

    it("should use list style for options", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Verbose",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({ optionStyle: "list" });
      const markdown = renderer(info);

      expect(markdown).toContain("- `-v`, `--verbose` - Verbose (default: false)");
      expect(markdown).not.toContain("| Option |");
    });

    it("should display kebab-case options in list style", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          dryRun: arg(z.boolean().default(false), { description: "Dry run mode" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({ optionStyle: "list" });
      const markdown = renderer(info);

      expect(markdown).toContain("--dry-run");
      expect(markdown).not.toContain("--dryRun");
    });

    it("should display env info in list style", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          port: arg(z.coerce.number(), { env: "PORT", description: "Server port" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({ optionStyle: "list" });
      const markdown = renderer(info);

      expect(markdown).toContain("[env: PORT]");
    });

    it("should display multiple env vars in list style", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          port: arg(z.coerce.number(), {
            env: ["PORT", "SERVER_PORT"],
            description: "Server port",
          }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({ optionStyle: "list" });
      const markdown = renderer(info);

      expect(markdown).toContain("[env: PORT, SERVER_PORT]");
    });

    it("should support renderOptions to add custom content after options", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          flag: arg(z.boolean().default(false), { description: "Flag" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({
        renderOptions: ({ options, render }) =>
          `${render(options)}\n\n**Custom Section:**\n\nSome custom content.`,
      });
      const markdown = renderer(info);

      expect(markdown).toContain("## Options");
      expect(markdown).toContain("**Custom Section:**");
      expect(markdown).toContain("Some custom content.");
    });

    it("should support renderOptions to hide options section", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          flag: arg(z.boolean().default(false), { description: "Flag" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({
        renderOptions: () => "", // Return empty string to hide section
      });
      const markdown = renderer(info);

      expect(markdown).not.toContain("## Options");
      expect(markdown).not.toContain("--flag");
    });

    it("should support renderOptions with custom style", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose mode" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({
        optionStyle: "table",
        renderOptions: ({ options, render }) => render(options, { style: "list" }),
      });
      const markdown = renderer(info);

      expect(markdown).toContain("- `-v`");
      expect(markdown).not.toContain("| Option |");
    });

    it("should support renderFooter to add custom footer", async () => {
      const cmd = defineCommand({
        name: "test",
        description: "Test command",
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const renderer = createCommandRenderer({
        renderFooter: () => "---\n\nGenerated by politty.",
      });
      const markdown = renderer(info);

      expect(markdown).toContain("Generated by politty.");
    });
  });

  describe("defaultRenderers", () => {
    it("should provide tableStyle preset", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          flag: arg(z.boolean().default(false), { description: "Flag" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const markdown = defaultRenderers.tableStyle(info);

      expect(markdown).toContain("| Option |");
    });

    it("should provide listStyle preset", async () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          flag: arg(z.boolean().default(false), { description: "Flag" }),
        }),
        run: () => {},
      });

      const info = await buildCommandInfo(cmd, "test");
      const markdown = defaultRenderers.listStyle(info);

      expect(markdown).toContain("- `--flag`");
      expect(markdown).not.toContain("| Option |");
    });
  });
});
