import * as fs from "node:fs";
import * as path from "node:path";
import { format } from "oxfmt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand } from "../index.js";
import { assertDocMatch, generateDoc } from "./golden-test.js";
import type { LayoutMd } from "./md-tag.js";
import { commandEndMarker, commandStartMarker, UPDATE_GOLDEN_ENV } from "./types.js";

/**
 * Remove a command's marker block from content.
 * @throws If the markers are not found in the content.
 */
function removeCommandBlock(content: string, commandPath: string): string {
  const startMarker = commandStartMarker(commandPath);
  const endMarker = commandEndMarker(commandPath);
  const startIdx = content.indexOf(startMarker);
  const endIdx = content.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) {
    throw new Error(
      `Marker not found in content. start="${startMarker}" (${startIdx}), end="${endMarker}" (${endIdx})`,
    );
  }
  const endPos = endIdx + endMarker.length;
  const sliceEnd = content[endPos] === "\n" ? endPos + 1 : endPos;
  return content.slice(0, startIdx) + content.slice(sliceEnd);
}

describe("golden-test", () => {
  const testDir = path.join(import.meta.dirname ?? __dirname, ".test-golden");

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  const testCommand = defineCommand({
    name: "test-cli",
    description: "A test CLI for documentation generation",
    args: z.object({
      verbose: arg(z.boolean().default(false), {
        alias: "v",
        description: "Enable verbose output",
      }),
    }),
    subCommands: {
      greet: defineCommand({
        name: "greet",
        description: "Greet someone",
        args: z.object({
          name: arg(z.string(), {
            positional: true,
            description: "Name to greet",
          }),
        }),
        run: () => {},
      }),
      config: defineCommand({
        name: "config",
        description: "Manage configuration",
        subCommands: {
          get: defineCommand({
            name: "get",
            description: "Get a config value",
            args: z.object({
              key: arg(z.string(), {
                positional: true,
                description: "Config key",
              }),
            }),
            run: () => {},
          }),
          set: defineCommand({
            name: "set",
            description: "Set a config value",
            args: z.object({
              key: arg(z.string(), { positional: true, description: "Config key" }),
              value: arg(z.string(), { positional: true, description: "Config value" }),
            }),
            run: () => {},
          }),
        },
      }),
    },
  });

  describe("generateDoc", () => {
    it("should create documentation file when it does not exist in update mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");
      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.status).toBe("created");
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("A test CLI for documentation generation");

      // The root command block is wrapped in exactly one command marker pair,
      // and each command has its own pair (root + 4 subcommands here).
      expect(content).toContain(commandStartMarker(""));
      expect(content).toContain(commandEndMarker(""));
      const starts = content.match(/<!-- politty:command:.*?:start -->/g) ?? [];
      const ends = content.match(/<!-- politty:command:.*?:end -->/g) ?? [];
      expect(starts).toHaveLength(5);
      expect(ends).toHaveLength(5);
      // No per-section markers remain.
      expect(content).not.toContain(":heading:start");
      expect(content).not.toContain(":usage:start");
    });

    it("should report match when content is identical", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should report diff when content does not match", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const filePath = path.join(testDir, "cli.md");
      fs.writeFileSync(filePath, "# Old content\n", "utf-8");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");
      expect(result.files[0]?.diff).toBeDefined();
      expect(result.error).toContain(UPDATE_GOLDEN_ENV);
    });

    it("should update file when POLITTY_DOCS_UPDATE is set", async () => {
      const filePath = path.join(testDir, "cli.md");
      fs.writeFileSync(filePath, "# Old content\n", "utf-8");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("updated");

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
    });

    it("should auto-include subcommands when parent is specified", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: ["config"] },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# config");
      expect(content).toContain("# config get");
      expect(content).toContain("# config set");
    });

    it("should handle multiple files with auto-included subcommands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "cli.md");
      const configPath = path.join(testDir, "config.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: { commands: ["greet"] },
          [configPath]: { commands: ["config"] },
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);

      const mainContent = fs.readFileSync(mainPath, "utf-8");
      expect(mainContent).toContain("# greet");
      expect(mainContent).not.toContain("# config");

      const configContent = fs.readFileSync(configPath, "utf-8");
      expect(configContent).toContain("# config");
      expect(configContent).toContain("# config get");
      expect(configContent).toContain("# config set");
    });

    it("should ignore specified commands and their subcommands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["config"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      expect(content).not.toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should ignore specific subcommands while keeping parent", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: ["config"] },
        },
        ignores: ["config set"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# config");
      expect(content).toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should throw error when files and ignores conflict", async () => {
      const filePath = path.join(testDir, "cli.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: { commands: ["config"] },
          },
          ignores: ["config"],
        }),
      ).rejects.toThrow("Conflict between files and ignores");
    });

    it("should throw error when files specify subcommand of ignored parent", async () => {
      const filePath = path.join(testDir, "cli.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: { commands: ["config get"] },
          },
          ignores: ["config"],
        }),
      ).rejects.toThrow("Conflict between files and ignores");
    });

    it("should support a per-command override via the flat command map", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "custom.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: {
            commands: {
              "": (md) =>
                md`
# Custom heading\n\nCustom content for the root command.
                `,
            },
          },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# Custom heading");
      expect(content).toContain("Custom content for the root command.");
      // Override output is still wrapped in exactly one command marker pair.
      expect(content).toContain(commandStartMarker(""));
      expect(content).toContain(commandEndMarker(""));
    });

    it("should support a custom file layout", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "layout.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: {
            commands: ["greet"],
            layout: (md: LayoutMd) => md`
              # Greeting Commands

              This section describes greeting commands.

              ${md.commands()}
            `,
          },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content.startsWith("# Greeting Commands")).toBe(true);
      expect(content).toContain("This section describes greeting commands.");
      expect(content).toContain("# greet");
    });

    it("should generate cross-file links when subcommands are in different files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "cli.md");
      const configPath = path.join(testDir, "config.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: { commands: [""] },
          [configPath]: { commands: ["config"] },
        },
        ignores: ["greet"],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);

      const mainContent = fs.readFileSync(mainPath, "utf-8");
      expect(mainContent).toContain("# test-cli");
      expect(mainContent).toContain("[`config`](config.md#config)");

      const configContent = fs.readFileSync(configPath, "utf-8");
      expect(configContent).toContain("# config");
      expect(configContent).toContain("[`config get`](#config-get)");
      expect(configContent).toContain("[`config set`](#config-set)");
    });

    it("should generate relative paths for nested directory structures", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      fs.mkdirSync(path.join(testDir, "docs"), { recursive: true });
      fs.mkdirSync(path.join(testDir, "docs", "commands"), { recursive: true });

      const mainPath = path.join(testDir, "docs", "cli.md");
      const configPath = path.join(testDir, "docs", "commands", "config.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: { commands: [""] },
          [configPath]: { commands: ["config"] },
        },
        ignores: ["greet"],
      });

      expect(result.success).toBe(true);

      const mainContent = fs.readFileSync(mainPath, "utf-8");
      expect(mainContent).toContain("[`config`](commands/config.md#config)");
    });

    it("should apply sync formatter before comparison", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "formatted.md");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
        formatter: (content) => content + "\n<!-- formatted -->\n",
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("<!-- formatted -->");
    });

    it("should apply async formatter before comparison", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "formatted-async.md");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
        formatter: async (content) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return content.toUpperCase();
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# TEST-CLI");
    });

    it("should work without formatter (undefined)", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "no-formatter.md");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
    });

    it("should compare formatted content correctly", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "formatted-compare.md");
      const formatter = (content: string) => content + "\n<!-- formatted -->\n";

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
        formatter,
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
        formatter,
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should propagate formatter errors", async () => {
      const filePath = path.join(testDir, "error.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: { [filePath]: { commands: [""] } },
          formatter: () => {
            throw new Error("Formatter error");
          },
        }),
      ).rejects.toThrow("Formatter error");
    });

    it("should format with oxfmt", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "oxfmt-formatted.md");

      const oxfmtFormatter = async (content: string) => {
        const { code } = await format("file.md", content);
        return code;
      };

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
        formatter: oxfmtFormatter,
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const matchResult = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
        formatter: oxfmtFormatter,
      });

      expect(matchResult.success).toBe(true);
      expect(matchResult.files[0]?.status).toBe("match");
    });

    it("should handle empty commands array in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "empty.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [] },
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(0);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("should handle non-existent command path in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "nonexistent.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: ["nonexistent"] },
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(0);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("should throw error when ignores includes root command that is in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "all-ignored.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: { commands: [""] },
          },
          ignores: [""],
        }),
      ).rejects.toThrow("Conflict between files and ignores");
    });

    it("should handle ignoring all subcommands while keeping root", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "root-only-ignored-subs.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["greet", "config"],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).not.toContain("# greet");
      expect(content).not.toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should handle empty ignores array", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "empty-ignores.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: [],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.status).toBe("created");

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      expect(content).toContain("# config");
    });

    it("should respect format.headingLevel option", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "heading-level.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: ["greet"] },
        },
        format: {
          headingLevel: 2,
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("## greet");
      expect(content).not.toMatch(/^# greet/m);
    });

    it("should use relative heading level within file (subcommand as top level)", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "config-only.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: ["config"] },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# config");
      expect(content).toContain("## config get");
      expect(content).toContain("## config set");
    });

    it("should use nested heading levels within single file", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "all-commands.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: ["", "greet", "config"] },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toMatch(/^# test-cli$/m);
      expect(content).toMatch(/^## greet$/m);
      expect(content).toMatch(/^## config$/m);
      expect(content).toMatch(/^### config get$/m);
      expect(content).toMatch(/^### config set$/m);
    });

    it("should allow same command in multiple files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "main.md");
      const duplicatePath = path.join(testDir, "duplicate.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: { commands: ["greet"] },
          [duplicatePath]: { commands: ["greet"] },
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);

      const mainContent = fs.readFileSync(mainPath, "utf-8");
      const duplicateContent = fs.readFileSync(duplicatePath, "utf-8");
      expect(mainContent).toContain("# greet");
      expect(duplicateContent).toContain("# greet");
    });

    it("should throw error when ignores contains non-existent command path", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "ignore-nonexistent.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: { commands: [""] },
          },
          ignores: ["nonexistent"],
        }),
      ).rejects.toThrow('Ignored command paths do not exist: "nonexistent"');
    });

    it("should list all non-existent command paths in error message", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "ignore-multiple-nonexistent.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: { commands: [""] },
          },
          ignores: ["foo", "bar", "greet"],
        }),
      ).rejects.toThrow('Ignored command paths do not exist: "foo", "bar"');
    });

    it("should ignore all top-level subcommands with wildcard *", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-top.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["*"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).not.toContain("# greet");
      expect(content).not.toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should ignore nested subcommands with wildcard * *", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-nested.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["* *"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      expect(content).toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should ignore specific parent subcommands with wildcard config *", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-parent.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["config *"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      expect(content).toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should throw error when wildcard pattern matches no commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-no-match.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: { commands: [""] },
          },
          ignores: ["* * *"],
        }),
      ).rejects.toThrow('Ignored command paths do not exist: "* * *"');
    });

    it("should expand wildcard in files to include matching commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-files.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: ["config *"] },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# config get");
      expect(content).toContain("# config set");
      expect(content).not.toContain("# test-cli");
      expect(content).not.toContain("# greet");
      expect(content).not.toContain("# config\n");
    });

    it("should detect conflict between files wildcard and ignores", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-conflict.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: { commands: ["config *"] },
          },
          ignores: ["config get"],
        }),
      ).rejects.toThrow("Conflict between files and ignores");
    });

    it("should handle both wildcard files and wildcard ignores", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-both.md");

      const deepCommand = defineCommand({
        name: "deep-cli",
        description: "CLI with deep nesting",
        subCommands: {
          alpha: defineCommand({
            name: "alpha",
            description: "Alpha command",
            subCommands: {
              one: defineCommand({
                name: "one",
                description: "One",
                args: z.object({}),
                run: () => {},
              }),
              two: defineCommand({
                name: "two",
                description: "Two",
                args: z.object({}),
                run: () => {},
              }),
            },
          }),
          beta: defineCommand({
            name: "beta",
            description: "Beta command",
            subCommands: {
              one: defineCommand({
                name: "one",
                description: "One",
                args: z.object({}),
                run: () => {},
              }),
              two: defineCommand({
                name: "two",
                description: "Two",
                args: z.object({}),
                run: () => {},
              }),
            },
          }),
        },
      });

      const result = await generateDoc({
        command: deepCommand,
        files: {
          [filePath]: { commands: ["*"] },
        },
        ignores: ["* two"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# alpha");
      expect(content).toContain("# beta");
      expect(content).toContain("## alpha one");
      expect(content).toContain("## beta one");
      // "two" subcommands should be excluded (no command markers for them).
      expect(content).not.toContain(commandStartMarker("alpha two"));
      expect(content).not.toContain(commandStartMarker("beta two"));
    });

    it("should ignore parent while including other commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "partial-ignore.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["config"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      expect(content).not.toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should handle multiple ignores correctly", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "multi-ignore.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["greet", "config set"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).not.toContain("# greet");
      expect(content).toContain("# config");
      expect(content).toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    it("should handle root command only (without subcommands)", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "root-only.md");

      const rootOnlyCommand = defineCommand({
        name: "simple-cli",
        description: "A simple CLI without subcommands",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Verbose output",
          }),
        }),
        run: () => {},
      });

      const result = await generateDoc({
        command: rootOnlyCommand,
        files: {
          [filePath]: { commands: [""] },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# simple-cli");
      expect(content).toContain("Verbose output");
    });

    it("should execute examples with shorthand true syntax", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "examples-shorthand.md");

      const commandWithExamples = defineCommand({
        name: "echo-cli",
        description: "Echo CLI with examples",
        args: z.object({
          message: arg(z.string(), {
            positional: true,
            description: "Message to echo",
          }),
        }),
        examples: [
          { cmd: "hello", desc: "Say hello" },
          { cmd: "world", desc: "Say world" },
        ],
        run: (args) => {
          console.log(args.message);
        },
      });

      const result = await generateDoc({
        command: commandWithExamples,
        files: {
          [filePath]: { commands: [""] },
        },
        examples: {
          "": true,
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# echo-cli");
      expect(content).toContain("Examples");
      expect(content).toContain("hello");
      expect(content).toContain("world");
    });

    it("should execute examples with mock and cleanup", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "examples-mock.md");

      let mockValue = "default";
      const commandWithMock = defineCommand({
        name: "mock-cli",
        description: "CLI with mock examples",
        args: z.object({}),
        examples: [{ cmd: "", desc: "Run with mock" }],
        run: () => {
          console.log(mockValue);
        },
      });

      const result = await generateDoc({
        command: commandWithMock,
        files: {
          [filePath]: { commands: [""] },
        },
        examples: {
          "": {
            mock: () => {
              mockValue = "mocked";
            },
            cleanup: () => {
              mockValue = "default";
            },
          },
        },
      });

      expect(result.success).toBe(true);
      expect(mockValue).toBe("default");

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("mocked");
    });

    it("should skip examples config for command without examples", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "no-examples.md");

      const commandWithoutExamples = defineCommand({
        name: "no-ex-cli",
        description: "CLI without examples",
        args: z.object({}),
        run: () => {},
      });

      const result = await generateDoc({
        command: commandWithoutExamples,
        files: {
          [filePath]: { commands: [""] },
        },
        examples: {
          "": true,
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# no-ex-cli");
      expect(content).not.toContain("Examples");
    });

    it("should not render examples for ignored commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "examples-ignored.md");

      const commandWithIgnoredExamples = defineCommand({
        name: "ignore-ex-cli",
        description: "CLI with ignored command examples",
        subCommands: {
          show: defineCommand({
            name: "show",
            description: "Show something",
            args: z.object({}),
            examples: [{ cmd: "", desc: "Show example" }],
            run: () => {
              console.log("show output");
            },
          }),
          hide: defineCommand({
            name: "hide",
            description: "Hide something",
            args: z.object({}),
            examples: [{ cmd: "", desc: "Hide example" }],
            run: () => {
              console.log("hide output");
            },
          }),
        },
      });

      const result = await generateDoc({
        command: commandWithIgnoredExamples,
        files: {
          [filePath]: { commands: [""] },
        },
        ignores: ["hide"],
        examples: {
          show: true,
          hide: true,
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# show");
      expect(content).toContain("show output");
      expect(content).not.toContain("# hide");
      expect(content).not.toContain("hide output");
    });

    it("should execute examples even if command not in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "examples-partial.md");

      const commandForPartialExamples = defineCommand({
        name: "partial-ex-cli",
        description: "CLI with partial examples",
        subCommands: {
          included: defineCommand({
            name: "included",
            description: "Included command",
            args: z.object({}),
            examples: [{ cmd: "", desc: "Included example" }],
            run: () => {
              console.log("included output");
            },
          }),
          excluded: defineCommand({
            name: "excluded",
            description: "Excluded command",
            args: z.object({}),
            examples: [{ cmd: "", desc: "Excluded example" }],
            run: () => {
              console.log("excluded output");
            },
          }),
        },
      });

      const result = await generateDoc({
        command: commandForPartialExamples,
        files: {
          [mainPath]: { commands: ["included"] },
        },
        examples: {
          included: true,
          excluded: true,
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(mainPath, "utf-8");
      expect(content).toContain("# included");
      expect(content).toContain("included output");
      expect(content).not.toContain("# excluded");
      expect(content).not.toContain("excluded output");
    });

    it("should apply formatter after examples are rendered", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "examples-formatter.md");

      const commandWithFormattedExamples = defineCommand({
        name: "fmt-ex-cli",
        description: "CLI with formatted examples",
        args: z.object({}),
        examples: [{ cmd: "", desc: "Example" }],
        run: () => {
          console.log("example output");
        },
      });

      const result = await generateDoc({
        command: commandWithFormattedExamples,
        files: {
          [filePath]: { commands: [""] },
        },
        examples: {
          "": true,
        },
        formatter: (content) => content.toUpperCase(),
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# FMT-EX-CLI");
      expect(content).toContain("EXAMPLE OUTPUT");
    });

    it("should not execute examples when examples config is not provided", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "no-examples-config.md");

      let executionCount = 0;
      const commandWithExamplesNoConfig = defineCommand({
        name: "no-config-cli",
        description: "CLI without examples config",
        args: z.object({}),
        examples: [{ cmd: "", desc: "Example that should not run" }],
        run: () => {
          executionCount++;
          console.log("should not be executed");
        },
      });

      const result = await generateDoc({
        command: commandWithExamplesNoConfig,
        files: {
          [filePath]: { commands: [""] },
        },
      });

      expect(result.success).toBe(true);
      expect(executionCount).toBe(0);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# no-config-cli");
      expect(content).toContain("Examples");
      expect(content).not.toContain("should not be executed");
    });
  });

  describe("targetCommands", () => {
    it("should validate only the target command section", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should update only the target command block", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
      });

      const originalContent = fs.readFileSync(filePath, "utf-8");
      expect(originalContent).toContain(commandStartMarker("greet"));

      const modifiedContent = originalContent.replace("## greet", "## MODIFIED greet");
      fs.writeFileSync(filePath, modifiedContent, "utf-8");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
        targetCommands: ["greet"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain(`${commandStartMarker("greet")}\n## greet`);
      expect(updatedContent).not.toContain("## MODIFIED greet");
    });

    it("should throw error for invalid target command", async () => {
      const filePath = path.join(testDir, "cli.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: { [filePath]: { commands: [""] } },
          targetCommands: ["nonexistent"],
        }),
      ).rejects.toThrow('Target command "nonexistent" not found');
    });

    it("should validate multiple target commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
        targetCommands: ["greet", "config"],
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should update multiple target command blocks", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
      });

      const originalContent = fs.readFileSync(filePath, "utf-8");
      let modifiedContent = originalContent.replace("## greet", "## MODIFIED greet");
      modifiedContent = modifiedContent.replace("## config\n", "## MODIFIED config\n");
      fs.writeFileSync(filePath, modifiedContent, "utf-8");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
        targetCommands: ["greet", "config"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain(`${commandStartMarker("greet")}\n## greet`);
      expect(updatedContent).toContain(`${commandStartMarker("config")}\n## config`);
      expect(updatedContent).not.toContain("## MODIFIED greet");
      expect(updatedContent).not.toContain("## MODIFIED config");
    });

    it("should handle target commands across multiple files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "main.md");
      const configPath = path.join(testDir, "config.md");

      await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: { commands: ["", "greet"] },
          [configPath]: { commands: ["config"] },
        },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: { commands: ["", "greet"] },
          [configPath]: { commands: ["config"] },
        },
        targetCommands: ["greet", "config"],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);
      expect(result.files.every((f) => f.status === "match")).toBe(true);
    });

    it("should skip non-target files entirely in targetCommands mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const targetPath = path.join(testDir, "target.md");
      const otherPath = path.join(testDir, "other.md");

      await generateDoc({
        command: testCommand,
        files: {
          [targetPath]: { commands: ["greet"] },
          [otherPath]: { commands: ["config"] },
        },
      });

      const otherContent = fs.readFileSync(otherPath, "utf-8");
      fs.writeFileSync(otherPath, otherContent.replace("## config", "## MODIFIED config"), "utf-8");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [targetPath]: { commands: ["greet"] },
          [otherPath]: { commands: ["config"] },
        },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.path).toBe(targetPath);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should hard-error when a target command has no command marker (read-only)", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "missing-marker.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
      });

      // Remove greet's command marker block entirely (simulating an old-format doc).
      const originalContent = fs.readFileSync(filePath, "utf-8");
      const withoutGreet = removeCommandBlock(originalContent, "greet");
      fs.writeFileSync(filePath, withoutGreet, "utf-8");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");
      expect(result.files[0]?.diff).toContain("No command marker found");
      expect(result.files[0]?.diff).toContain("greet");
    });

    it("should re-insert a missing target command block in update mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "reinsert.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
      });

      const originalContent = fs.readFileSync(filePath, "utf-8");
      const withoutGreet = removeCommandBlock(originalContent, "greet");
      fs.writeFileSync(filePath, withoutGreet, "utf-8");
      expect(withoutGreet).not.toContain(commandStartMarker("greet"));

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["", "greet", "config"] } },
        targetCommands: ["greet"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain(commandStartMarker("greet"));
      expect(updatedContent).toContain("# greet");
    });

    it("should insert new subcommand at correct position when parent is in targetCommands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "config.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["config"] } },
      });

      const initialContent = fs.readFileSync(filePath, "utf-8");
      expect(initialContent).toContain(commandStartMarker("config get"));
      expect(initialContent).toContain(commandStartMarker("config set"));

      const extendedCommand = defineCommand({
        name: "test-cli",
        description: "A test CLI for documentation generation",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose output",
          }),
        }),
        subCommands: {
          greet: defineCommand({
            name: "greet",
            description: "Greet someone",
            args: z.object({
              name: arg(z.string(), {
                positional: true,
                description: "Name to greet",
              }),
            }),
            run: () => {},
          }),
          config: defineCommand({
            name: "config",
            description: "Manage configuration",
            subCommands: {
              get: defineCommand({
                name: "get",
                description: "Get a config value",
                args: z.object({
                  key: arg(z.string(), {
                    positional: true,
                    description: "Config key",
                  }),
                }),
                run: () => {},
              }),
              set: defineCommand({
                name: "set",
                description: "Set a config value",
                args: z.object({
                  key: arg(z.string(), { positional: true, description: "Config key" }),
                  value: arg(z.string(), { positional: true, description: "Config value" }),
                }),
                run: () => {},
              }),
              delete: defineCommand({
                name: "delete",
                description: "Delete a config value",
                args: z.object({
                  key: arg(z.string(), { positional: true, description: "Config key to delete" }),
                }),
                run: () => {},
              }),
            },
          }),
        },
      });

      await generateDoc({
        command: extendedCommand,
        files: { [filePath]: { commands: ["config"] } },
        targetCommands: ["config"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain(commandStartMarker("config delete"));

      const deletePos = updatedContent.indexOf(commandStartMarker("config delete"));
      const getPos = updatedContent.indexOf(commandStartMarker("config get"));
      const setPos = updatedContent.indexOf(commandStartMarker("config set"));

      expect(deletePos).toBeLessThan(getPos);
      expect(getPos).toBeLessThan(setPos);
    });

    it("should remove orphaned command markers for deleted commands in update mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "file-remove-orphan.md");

      fs.writeFileSync(
        filePath,
        `${commandStartMarker("greet")}
## greet
${commandEndMarker("greet")}

${commandStartMarker("removed")}
## removed command
${commandEndMarker("removed")}
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["greet"] } },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(true);
      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).not.toContain(commandStartMarker("removed"));
      expect(updatedContent).not.toContain("removed command");
      expect(updatedContent).toContain(commandStartMarker("greet"));
    });

    it("should detect orphaned command markers for deleted commands in validation mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "file-detect-orphan.md");

      // First generate the real greet block, then append an orphan marker.
      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["greet"] } },
      });
      const generated = fs.readFileSync(filePath, "utf-8");
      fs.writeFileSync(
        filePath,
        `${generated.trimEnd()}\n\n${commandStartMarker("removed")}\n## removed\n${commandEndMarker("removed")}\n`,
        "utf-8",
      );

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: ["greet"] } },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.diff).toContain("orphaned command marker");
      expect(result.files[0]?.diff).toContain("removed");
    });
  });

  describe("assertDocMatch", () => {
    it("should not throw when documentation matches", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: { commands: [""] } },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      await expect(
        assertDocMatch({
          command: testCommand,
          files: { [filePath]: { commands: [""] } },
        }),
      ).resolves.toBeUndefined();
    });

    it("should throw when documentation does not match", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const filePath = path.join(testDir, "cli.md");
      fs.writeFileSync(filePath, "# Wrong content\n", "utf-8");

      await expect(
        assertDocMatch({
          command: testCommand,
          files: { [filePath]: { commands: [""] } },
        }),
      ).rejects.toThrow("Documentation does not match golden files");
    });

    it("should update files in update mode instead of throwing", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");
      fs.writeFileSync(filePath, "# Wrong content\n", "utf-8");

      await expect(
        assertDocMatch({
          command: testCommand,
          files: { [filePath]: { commands: [""] } },
        }),
      ).resolves.toBeUndefined();

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
    });
  });

  describe("rootDoc default layout", () => {
    it("should generate and match the default root layout with globalOptions and index", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "REFERENCE.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      const config = {
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          globalOptions: {
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
          },
        },
        files: {
          [greetPath]: { commands: ["greet"] },
        },
      };

      const created = await generateDoc(config);
      expect(created.success).toBe(true);

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("A test CLI for documentation generation");
      expect(content).toContain('<a id="global-options"></a>');
      expect(content).toContain("--verbose");
      // The rootDoc is markerless except inside md.commands() (none here).
      expect(content).not.toContain("politty:global-options");
      expect(content).not.toContain("politty:index");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      const matched = await generateDoc(config);
      expect(matched.success).toBe(true);
      expect(matched.files.find((f) => f.path === rootDocPath)?.status).toBe("match");
    });

    it("should error when rootDoc file does not exist (read-only)", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "missing-reference.md");
      const greetPath = path.join(testDir, "cli", "greet.md");
      fs.mkdirSync(path.dirname(greetPath), { recursive: true });

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath },
        files: { [greetPath]: { commands: ["greet"] } },
      });

      expect(result.success).toBe(false);
      expect(result.files.find((f) => f.path === rootDocPath)?.status).toBe("diff");
    });

    it("should support a custom rootDoc layout with free text", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "custom-reference.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      const config = {
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          globalOptions: {
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
          },
          layout: (md: LayoutMd) => md`
            # Custom Reference

            Intro prose.

            ## Global Options

            ${md.globalOptions}

            ## Command Reference

            ${md.index}
          `,
        },
        files: {
          [greetPath]: { commands: ["greet"] },
        },
      };

      const created = await generateDoc(config);
      expect(created.success).toBe(true);

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content.startsWith("# Custom Reference")).toBe(true);
      expect(content).toContain("Intro prose.");
      expect(content).toContain("## Global Options");
      expect(content).toContain("## Command Reference");
      expect(content).toContain("--verbose");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      const matched = await generateDoc(config);
      expect(matched.success).toBe(true);
      expect(matched.files.find((f) => f.path === rootDocPath)?.status).toBe("match");
    });

    it("should use FileConfig.index to label the command index entry", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "labeled-reference.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      const config = {
        command: testCommand,
        rootDoc: { path: rootDocPath },
        files: {
          [greetPath]: {
            commands: ["greet"],
            index: { title: "Greeting Commands", description: "Say hello, your way." },
          },
        },
      };

      const created = await generateDoc(config);
      expect(created.success).toBe(true);

      const content = fs.readFileSync(rootDocPath, "utf-8");
      // The curated label wins over the first command's name/description.
      expect(content).toContain("[Greeting Commands]");
      expect(content).toContain("Say hello, your way.");
      expect(content).not.toMatch(/\[greet\]\(\.\/cli\/greet\.md\)/);

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      const matched = await generateDoc(config);
      expect(matched.success).toBe(true);
    });

    it("should support custom heading levels via rootDoc.headingLevel and index", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "levels.md");
      const filePath = path.join(testDir, "cmds.md");

      const config = {
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          headingLevel: 2 as const,
          index: { headingLevel: 4 as const },
        },
        files: {
          [filePath]: { commands: ["greet", "config"] },
        },
      };

      const created = await generateDoc(config);
      expect(created.success).toBe(true);

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toMatch(/^## test-cli$/m);
      expect(content).toMatch(/^#### \[/m);
    });
  });

  describe("rootDoc.path overlap with files", () => {
    it("should throw when rootDoc.path is also in files", async () => {
      const filePath = path.join(testDir, "overlap.md");

      await expect(
        generateDoc({
          command: testCommand,
          rootDoc: { path: filePath },
          files: {
            [filePath]: { commands: ["greet"] },
          },
        }),
      ).rejects.toThrow("must not also appear as a key in files");
    });

    it("should throw when rootDoc.path overlaps with normalized files path", async () => {
      const filePath = path.join(testDir, "overlap-normalized.md");
      const equivalentPath = `${path.dirname(filePath)}${path.sep}.${path.sep}${path.basename(filePath)}`;

      await expect(
        generateDoc({
          command: testCommand,
          rootDoc: { path: filePath },
          files: {
            [equivalentPath]: { commands: ["greet"] },
          },
        }),
      ).rejects.toThrow("must not also appear as a key in files");
    });
  });

  describe("auto-exclude globalOptions from command options", () => {
    const commandWithSharedOptions = defineCommand({
      name: "shared-cli",
      description: "CLI with shared options",
      subCommands: {
        build: defineCommand({
          name: "build",
          description: "Build the project",
          args: z.object({
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
            env: arg(z.string().default("development"), {
              alias: "e",
              description: "Target environment",
            }),
            watch: arg(z.boolean().default(false), {
              alias: "w",
              description: "Watch for changes",
            }),
          }),
          run: () => {},
        }),
        deploy: defineCommand({
          name: "deploy",
          description: "Deploy the project",
          args: z.object({
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
            env: arg(z.string().default("development"), {
              alias: "e",
              description: "Target environment",
            }),
            force: arg(z.boolean().default(false), {
              alias: "f",
              description: "Force deployment",
            }),
          }),
          run: () => {},
        }),
      },
    });

    it("should exclude globalOptions from command option tables", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const result = await generateDoc({
        command: commandWithSharedOptions,
        rootDoc: {
          path: refPath,
          globalOptions: {
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
            env: arg(z.string().default("development"), {
              alias: "e",
              description: "Target environment",
            }),
          },
        },
        files: {
          [readmePath]: { commands: ["build", "deploy"] },
        },
      });

      expect(result.success).toBe(true);

      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      expect(readmeContent).not.toContain("--verbose");
      expect(readmeContent).not.toContain("--env");
      expect(readmeContent).toContain("--watch");
      expect(readmeContent).toContain("--force");
    });

    it("should keep all options in the rootDoc global options table", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const result = await generateDoc({
        command: commandWithSharedOptions,
        rootDoc: {
          path: refPath,
          globalOptions: {
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
          },
        },
        files: {
          [readmePath]: { commands: ["build"] },
        },
      });

      expect(result.success).toBe(true);

      const refContent = fs.readFileSync(refPath, "utf-8");
      expect(refContent).toContain("--verbose");
      expect(refContent).toContain("Enable verbose output");
    });

    it("should pass filtered CommandInfo to a command override", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const result = await generateDoc({
        command: commandWithSharedOptions,
        rootDoc: {
          path: refPath,
          globalOptions: {
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
          },
        },
        files: {
          [readmePath]: {
            commands: {
              build: (md) => md`# build\n\n${md.options}`,
            },
          },
        },
      });

      expect(result.success).toBe(true);
      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      // verbose excluded; env and watch remain.
      expect(readmeContent).not.toContain("--verbose");
      expect(readmeContent).toContain("--env");
      expect(readmeContent).toContain("--watch");
    });

    it("should not exclude options when no rootDoc globalOptions exist", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "no-args.md");

      const result = await generateDoc({
        command: commandWithSharedOptions,
        files: {
          [filePath]: { commands: ["build"] },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("--verbose");
      expect(content).toContain("--env");
      expect(content).toContain("--watch");
    });

    it("should handle ArgsConfigWithOptions shape for exclusion", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const result = await generateDoc({
        command: commandWithSharedOptions,
        rootDoc: {
          path: refPath,
          globalOptions: {
            args: {
              verbose: arg(z.boolean().default(false), {
                alias: "v",
                description: "Enable verbose output",
              }),
            },
          },
        },
        files: {
          [readmePath]: { commands: ["build"] },
        },
      });

      expect(result.success).toBe(true);

      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      expect(readmeContent).not.toContain("--verbose");
      expect(readmeContent).toContain("--env");
      expect(readmeContent).toContain("--watch");
    });

    it("should not exclude command option when globalOptions key is positional", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "positional-name-readme.md");
      const refPath = path.join(testDir, "positional-name-reference.md");

      const positionalMarkerCommand = defineCommand({
        name: "positional-marker-cli",
        description: "CLI for positional marker exclusion tests",
        subCommands: {
          create: defineCommand({
            name: "create",
            description: "Create a resource",
            args: z.object({
              name: arg(z.string(), {
                description: "Resource name option",
              }),
              verbose: arg(z.boolean().default(false), {
                alias: "v",
                description: "Enable verbose output",
              }),
            }),
            run: () => {},
          }),
        },
      });

      const result = await generateDoc({
        command: positionalMarkerCommand,
        rootDoc: {
          path: refPath,
          globalOptions: {
            name: arg(z.string(), {
              positional: true,
              description: "Resource name positional argument",
            }),
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
          },
        },
        files: {
          [readmePath]: { commands: ["create"] },
        },
      });

      expect(result.success).toBe(true);

      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      const refContent = fs.readFileSync(refPath, "utf-8");

      expect(readmeContent).toContain("--name");
      expect(readmeContent).not.toContain("--verbose");
      expect(refContent).toContain("--verbose");
      expect(refContent).not.toContain("--name");
    });

    it("should throw when command option conflicts with globalOptions definition", async () => {
      const readmePath = path.join(testDir, "conflict-readme.md");
      const refPath = path.join(testDir, "conflict-reference.md");

      const commandWithConflictingOptions = defineCommand({
        name: "conflict-cli",
        description: "CLI with conflicting option definitions",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Build output directory",
              }),
            }),
            run: () => {},
          }),
          deploy: defineCommand({
            name: "deploy",
            args: z.object({
              output: arg(z.string().default("prod"), {
                alias: "o",
                description: "Deployment output target",
              }),
            }),
            run: () => {},
          }),
        },
      });

      await expect(
        generateDoc({
          command: commandWithConflictingOptions,
          rootDoc: {
            path: refPath,
            globalOptions: {
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Build output directory",
              }),
            },
          },
          files: {
            [readmePath]: { commands: ["build", "deploy"] },
          },
        }),
      ).rejects.toThrow('does not match globalOptions definition for "output"');
    });

    it("should ignore non-target globalOptions conflicts in targetCommands mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const targetPath = path.join(testDir, "target-build.md");
      const nonTargetPath = path.join(testDir, "non-target-deploy.md");
      const refPath = path.join(testDir, "target-conflict-reference.md");

      const commandWithTargetConflict = defineCommand({
        name: "target-conflict-cli",
        description: "CLI with target-only conflict behavior",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
            }),
            run: () => {},
          }),
          deploy: defineCommand({
            name: "deploy",
            args: z.object({
              output: arg(z.string().default("prod"), {
                alias: "o",
                description: "Deployment output target",
              }),
            }),
            run: () => {},
          }),
        },
      });

      // First create both files (full mode) so the target file has markers.
      await generateDoc({
        command: commandWithTargetConflict,
        rootDoc: {
          path: refPath,
          globalOptions: {
            output: arg(z.string().default("dist"), {
              alias: "o",
              description: "Output directory",
            }),
          },
        },
        files: {
          [targetPath]: { commands: ["build"] },
          [nonTargetPath]: { commands: ["deploy"] },
        },
        targetCommands: ["build"],
      });

      const result = await generateDoc({
        command: commandWithTargetConflict,
        rootDoc: {
          path: refPath,
          globalOptions: {
            output: arg(z.string().default("dist"), {
              alias: "o",
              description: "Output directory",
            }),
          },
        },
        files: {
          [targetPath]: { commands: ["build"] },
          [nonTargetPath]: { commands: ["deploy"] },
        },
        targetCommands: ["build"],
      });

      expect(result.success).toBe(true);
      expect(result.files.some((f) => f.path === nonTargetPath)).toBe(false);
      const targetContent = fs.readFileSync(targetPath, "utf-8");
      expect(targetContent).not.toContain("--output");
    });

    it("should ignore conflicts from commands not mapped to documentation files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "partial-doc-readme.md");
      const refPath = path.join(testDir, "partial-doc-reference.md");

      const partialDocCommand = defineCommand({
        name: "partial-doc-cli",
        description: "CLI with partially documented commands",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
            }),
            run: () => {},
          }),
          deploy: defineCommand({
            name: "deploy",
            args: z.object({
              output: arg(z.string().default("prod"), {
                alias: "o",
                description: "Deployment output target",
              }),
            }),
            run: () => {},
          }),
        },
      });

      const result = await generateDoc({
        command: partialDocCommand,
        rootDoc: {
          path: refPath,
          globalOptions: {
            output: arg(z.string().default("dist"), {
              alias: "o",
              description: "Output directory",
            }),
          },
        },
        files: {
          [readmePath]: { commands: ["build"] },
        },
      });

      expect(result.success).toBe(true);
      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      expect(readmeContent).not.toContain("--output");
    });

    it("should throw when command option defaultValue conflicts with globalOptions definition", async () => {
      const readmePath = path.join(testDir, "default-conflict-readme.md");
      const refPath = path.join(testDir, "default-conflict-reference.md");

      const commandWithDefaultConflict = defineCommand({
        name: "default-conflict-cli",
        description: "CLI with conflicting option defaults",
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
            }),
            run: () => {},
          }),
          deploy: defineCommand({
            name: "deploy",
            args: z.object({
              output: arg(z.string().default("prod"), {
                alias: "o",
                description: "Output directory",
              }),
            }),
            run: () => {},
          }),
        },
      });

      await expect(
        generateDoc({
          command: commandWithDefaultConflict,
          rootDoc: {
            path: refPath,
            globalOptions: {
              output: arg(z.string().default("dist"), {
                alias: "o",
                description: "Output directory",
              }),
            },
          },
          files: {
            [readmePath]: { commands: ["build", "deploy"] },
          },
        }),
      ).rejects.toThrow('does not match globalOptions definition for "output"');
    });

    it("should process rootDoc with targetCommands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const config = {
        command: commandWithSharedOptions,
        rootDoc: {
          path: refPath,
          globalOptions: {
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
          },
        },
        files: {
          [readmePath]: { commands: ["build", "deploy"] },
        },
      };

      await generateDoc(config);

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        ...config,
        targetCommands: ["build"],
      });

      expect(result.success).toBe(true);
      // Results include the target file and the rootDoc.
      expect(result.files.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("PathConfig specificity", () => {
    it("should not duplicate descendant in ancestor file when descendant has own file", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootPath = path.join(testDir, "root.md");
      const configPath = path.join(testDir, "config.md");
      const getPath = path.join(testDir, "get.md");

      await generateDoc({
        command: testCommand,
        path: {
          root: rootPath,
          commands: {
            config: configPath,
            "config get": getPath,
          },
        },
      });

      const configContent = fs.readFileSync(configPath, "utf-8");
      const getContent = fs.readFileSync(getPath, "utf-8");

      expect(getContent).toContain("config get");
      expect(configContent).toContain("config set");
      expect(configContent).not.toMatch(/## config get\b/);
    });
  });
});
