import * as fs from "node:fs";
import * as path from "node:path";
import { format } from "oxfmt";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand } from "../index.js";
import { assertDocMatch, generateDoc, initDocFile } from "./golden-test.js";
import { renderArgsTable } from "./render-args.js";
import { renderCommandIndex } from "./render-index.js";
import {
  DOCTOR_ENV,
  SECTION_TYPES,
  sectionEndMarker,
  sectionStartMarker,
  UPDATE_GOLDEN_ENV,
  type SectionType,
} from "./types.js";

/**
 * Remove a section marker block from content.
 * Uses production marker functions to ensure format consistency.
 * @throws If markers are not found in the content
 */
function removeSectionBlock(content: string, type: SectionType, scope: string): string {
  const startMarker = sectionStartMarker(type, scope);
  const endMarker = sectionEndMarker(type, scope);
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

/** Get relative path from CWD (for index marker scope) */
function relPath(absPath: string): string {
  return path.relative(process.cwd(), absPath).replace(/\\/g, "/");
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
          [filePath]: [""],
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.status).toBe("created");
      expect(fs.existsSync(filePath)).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("A test CLI for documentation generation");

      // Verify all expected section markers are included
      const expectedSections: SectionType[] = [
        "heading",
        "description",
        "usage",
        "options",
        "subcommands",
      ];
      for (const section of expectedSections) {
        expect(content).toContain(`<!-- politty:command::${section}:start -->`);
        expect(content).toContain(`<!-- politty:command::${section}:end -->`);
      }

      // Verify sections without data are not included
      const absentSections = SECTION_TYPES.filter((s) => !expectedSections.includes(s));
      for (const section of absentSections) {
        expect(content).not.toContain(`<!-- politty:command::${section}:start -->`);
      }
    });

    it("should report match when content is identical", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      // First, create the file
      await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Then check it matches
      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should report diff when content does not match", async () => {
      // Ensure update mode is disabled for this test
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const filePath = path.join(testDir, "cli.md");
      fs.writeFileSync(filePath, "# Old content\n", "utf-8");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
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
        files: { [filePath]: [""] },
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
          // Only specify "config", subcommands should be auto-included
          [filePath]: ["config"],
        },
      });

      expect(result.success).toBe(true);

      // Config file should contain config AND its subcommands
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
          [mainPath]: ["greet"],
          // Only specify "config", subcommands auto-included
          [configPath]: ["config"],
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);

      // Main file should contain greet
      const mainContent = fs.readFileSync(mainPath, "utf-8");
      expect(mainContent).toContain("# greet");
      expect(mainContent).not.toContain("# config");

      // Config file should contain config and its subcommands
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
          [filePath]: [""],
        },
        ignores: ["config"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      // config and its subcommands should be excluded
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
          [filePath]: ["config"],
        },
        ignores: ["config set"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# config");
      expect(content).toContain("# config get");
      // Only "config set" should be excluded
      expect(content).not.toContain("# config set");
    });

    it("should throw error when files and ignores conflict", async () => {
      const filePath = path.join(testDir, "cli.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: ["config"],
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
            [filePath]: ["config get"],
          },
          ignores: ["config"],
        }),
      ).rejects.toThrow("Conflict between files and ignores");
    });

    it("should support custom renderer per file", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "custom.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: {
            commands: [""],
            render: (info) => `# Custom: ${info.name}\n\nCustom content for ${info.name}.\n`,
          },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# Custom: test-cli");
      expect(content).toContain("Custom content for test-cli.");
    });

    it("should generate cross-file links when subcommands are in different files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "cli.md");
      const configPath = path.join(testDir, "config.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: [""],
          [configPath]: ["config"],
        },
        ignores: ["greet"],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);

      // Main file should have link to config.md for config subcommand
      const mainContent = fs.readFileSync(mainPath, "utf-8");
      expect(mainContent).toContain("# test-cli");
      expect(mainContent).toContain("[`config`](config.md#config)");

      // Config file should have same-file anchors for its subcommands
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
          [mainPath]: [""],
          [configPath]: ["config"],
        },
        ignores: ["greet"],
      });

      expect(result.success).toBe(true);

      // Main file should have relative link to nested config.md
      const mainContent = fs.readFileSync(mainPath, "utf-8");
      expect(mainContent).toContain("[`config`](commands/config.md#config)");
    });

    it("should apply sync formatter before comparison", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "formatted.md");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
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
        files: { [filePath]: [""] },
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
        files: { [filePath]: [""] },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
    });

    it("should compare formatted content correctly", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "formatted-compare.md");
      const formatter = (content: string) => content + "\n<!-- formatted -->\n";

      // Create formatted file
      await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
        formatter,
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Compare with same formatter - should match
      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
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
          files: { [filePath]: [""] },
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
        files: { [filePath]: [""] },
        formatter: oxfmtFormatter,
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Compare with same formatter - should match
      const matchResult = await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
        formatter: oxfmtFormatter,
      });

      expect(matchResult.success).toBe(true);
      expect(matchResult.files[0]?.status).toBe("match");
    });

    // Edge case: empty commands array
    it("should handle empty commands array in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "empty.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [],
        },
      });

      expect(result.success).toBe(true);
      // File with empty commands should be skipped (no files created)
      expect(result.files).toHaveLength(0);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it("should throw when object file config omits commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "invalid-config.md");
      const invalidFileConfig = {
        title: "Invalid config",
      } as unknown as { commands: string[]; title?: string };

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: invalidFileConfig,
          },
        }),
      ).rejects.toThrow('Invalid file config: object form must include a "commands" array');
    });

    // Edge case: non-existent command path in files
    it("should handle non-existent command path in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "nonexistent.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: ["nonexistent"],
        },
      });

      expect(result.success).toBe(true);
      // Non-existent command should result in empty file content (skipped)
      expect(result.files).toHaveLength(0);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    // Edge case: ignores all commands - should throw conflict error
    it("should throw error when ignores includes root command that is in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "all-ignored.md");

      // Ignoring "" while files specifies "" should be a conflict
      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: [""],
          },
          ignores: [""],
        }),
      ).rejects.toThrow("Conflict between files and ignores");
    });

    // Edge case: ignores all subcommands but keeps root (not a conflict)
    it("should handle ignoring all subcommands while keeping root", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "root-only-ignored-subs.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [""],
        },
        ignores: ["greet", "config"],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);

      const content = fs.readFileSync(filePath, "utf-8");
      // Root should be present
      expect(content).toContain("# test-cli");
      // All subcommands should be excluded
      expect(content).not.toContain("# greet");
      expect(content).not.toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    // Edge case: empty ignores array (should be same as no ignores)
    it("should handle empty ignores array", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "empty-ignores.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [""],
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

    // FileConfig: title
    it("should add file title when specified in FileConfig", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "titled.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: {
            commands: ["greet"],
            title: "Greeting Commands",
          },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content.startsWith("# Greeting Commands\n")).toBe(true);
      expect(content).toContain("# greet");
    });

    // FileConfig: description
    it("should add file description when specified in FileConfig", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "described.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: {
            commands: ["greet"],
            description: "This section describes greeting commands.",
          },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("This section describes greeting commands.");
      expect(content).toContain("# greet");
    });

    // FileConfig: title + description
    it("should add both title and description when specified", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "titled-described.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: {
            commands: ["greet"],
            title: "Greet Commands",
            description: "Commands for greeting users.",
          },
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content.startsWith("# Greet Commands\n")).toBe(true);
      expect(content).toContain("Commands for greeting users.");
      expect(content).toContain("# greet");
    });

    // Format option: headingLevel
    it("should respect format.headingLevel option", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "heading-level.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: ["greet"],
        },
        format: {
          headingLevel: 2,
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      // Should use ## instead of # (check with line start to avoid substring matching)
      expect(content).toContain("## greet");
      // Ensure no single # heading for greet (check that "# greet" without preceding # doesn't exist)
      expect(content).not.toMatch(/^# greet/m);
    });

    it("should use relative heading level within file (subcommand as top level)", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "config-only.md");

      // File containing only config and its subcommands (no root command)
      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: ["config"],
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      // config (depth=2) should be # since it's the minimum depth in file
      expect(content).toContain("# config");
      // config get (depth=3) should be ## (relative to config)
      expect(content).toContain("## config get");
      // config set (depth=3) should be ## (relative to config)
      expect(content).toContain("## config set");
    });

    it("should use nested heading levels within single file", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "all-commands.md");

      // File containing root and all subcommands
      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: ["", "greet", "config"],
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      // root (depth=1) → #
      expect(content).toMatch(/^# test-cli$/m);
      // greet (depth=2) → ##
      expect(content).toMatch(/^## greet$/m);
      // config (depth=2) → ##
      expect(content).toMatch(/^## config$/m);
      // config get (depth=3) → ###
      expect(content).toMatch(/^### config get$/m);
      // config set (depth=3) → ###
      expect(content).toMatch(/^### config set$/m);
    });

    // Multiple files with overlapping commands
    it("should allow same command in multiple files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "main.md");
      const duplicatePath = path.join(testDir, "duplicate.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: ["greet"],
          [duplicatePath]: ["greet"],
        },
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(2);

      // Both files should contain greet
      const mainContent = fs.readFileSync(mainPath, "utf-8");
      const duplicateContent = fs.readFileSync(duplicatePath, "utf-8");
      expect(mainContent).toContain("# greet");
      expect(duplicateContent).toContain("# greet");
    });

    // ignores with non-existent command path should throw error
    it("should throw error when ignores contains non-existent command path", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "ignore-nonexistent.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: [""],
          },
          ignores: ["nonexistent"],
        }),
      ).rejects.toThrow('Ignored command paths do not exist: "nonexistent"');
    });

    // ignores with multiple non-existent command paths should list all
    it("should list all non-existent command paths in error message", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "ignore-multiple-nonexistent.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: [""],
          },
          ignores: ["foo", "bar", "greet"], // greet exists, foo and bar don't
        }),
      ).rejects.toThrow('Ignored command paths do not exist: "foo", "bar"');
    });

    // Wildcard: ignore all top-level subcommands with "*"
    it("should ignore all top-level subcommands with wildcard *", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-top.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [""],
        },
        ignores: ["*"], // Ignore all top-level subcommands (greet, config)
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      // All subcommands should be excluded
      expect(content).not.toContain("# greet");
      expect(content).not.toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    // Wildcard: ignore nested subcommands with "* *"
    it("should ignore nested subcommands with wildcard * *", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-nested.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [""],
        },
        ignores: ["* *"], // Ignore all 2-level deep subcommands (config get, config set)
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      expect(content).toContain("# config");
      // Only nested subcommands should be excluded
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    // Wildcard: ignore specific parent's subcommands with "config *"
    it("should ignore specific parent subcommands with wildcard config *", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-parent.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [""],
        },
        ignores: ["config *"], // Ignore only config's subcommands
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      expect(content).toContain("# config");
      // Only config's subcommands should be excluded
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    // Wildcard: error when wildcard pattern matches no commands
    it("should throw error when wildcard pattern matches no commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-no-match.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: [""],
          },
          ignores: ["* * *"], // No 3-level deep subcommands exist
        }),
      ).rejects.toThrow('Ignored command paths do not exist: "* * *"');
    });

    // Wildcard: files with wildcard pattern
    it("should expand wildcard in files to include matching commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-files.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: ["config *"], // Include only config's subcommands
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      // Should contain config's subcommands
      expect(content).toContain("# config get");
      expect(content).toContain("# config set");
      // Should not contain root or greet
      expect(content).not.toContain("# test-cli");
      expect(content).not.toContain("# greet");
      expect(content).not.toContain("# config\n"); // config itself should not be included
    });

    // Wildcard: conflict between files wildcard and ignores
    it("should detect conflict between files wildcard and ignores", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-conflict.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: {
            [filePath]: ["config *"], // Include config's subcommands
          },
          ignores: ["config get"], // But ignore config get
        }),
      ).rejects.toThrow("Conflict between files and ignores");
    });

    // Wildcard: combining wildcard files and wildcard ignores
    it("should handle both wildcard files and wildcard ignores", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "wildcard-both.md");

      // Create a deeper command structure for this test
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
          [filePath]: ["*"], // Include all top-level: alpha, beta
        },
        ignores: ["* two"], // Ignore all "two" subcommands
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# alpha");
      expect(content).toContain("# beta");
      // Subcommands use full path in title
      expect(content).toContain("## alpha one");
      expect(content).toContain("## beta one");
      // "two" subcommands should be excluded (check for section markers)
      expect(content).not.toContain("<!-- politty:command:alpha two:heading:start -->");
      expect(content).not.toContain("<!-- politty:command:beta two:heading:start -->");
    });

    // Combined: ignores parent command while files specifies different commands
    it("should ignore parent while including other commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "partial-ignore.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [""],
        },
        ignores: ["config"],
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
      expect(content).toContain("# greet");
      // config and all its subcommands should be excluded
      expect(content).not.toContain("# config");
      expect(content).not.toContain("# config get");
      expect(content).not.toContain("# config set");
    });

    // Combined: multiple ignores
    it("should handle multiple ignores correctly", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "multi-ignore.md");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [filePath]: [""],
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

    // Root command only
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
          [filePath]: [""],
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# simple-cli");
      expect(content).toContain("Verbose output");
    });

    // examples: shorthand true syntax
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
          [filePath]: [""],
        },
        examples: {
          "": true, // shorthand syntax
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# echo-cli");
      expect(content).toContain("Examples");
      expect(content).toContain("hello");
      expect(content).toContain("world");
    });

    // examples with mock/cleanup
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
          [filePath]: [""],
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
      expect(mockValue).toBe("default"); // cleanup should have restored the value

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("mocked"); // the mock value should be in the output
    });

    // examples for command without examples defined (should be skipped)
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
          [filePath]: [""],
        },
        examples: {
          "": true, // This should be skipped since command has no examples
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# no-ex-cli");
      expect(content).not.toContain("Examples"); // No examples section
    });

    // examples + ignores: examples for ignored command should be skipped
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
          [filePath]: [""],
        },
        ignores: ["hide"],
        examples: {
          show: true,
          hide: true, // This should be executed but hide command won't be in output
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# show");
      expect(content).toContain("show output");
      // hide command should be ignored
      expect(content).not.toContain("# hide");
      expect(content).not.toContain("hide output");
    });

    // examples for command not in files (examples should still be executed)
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
          [mainPath]: ["included"], // only include 'included' command
        },
        examples: {
          included: true,
          excluded: true, // This will be executed but excluded is not in files
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(mainPath, "utf-8");
      expect(content).toContain("# included");
      expect(content).toContain("included output");
      // excluded command should not be in file (not in files config)
      expect(content).not.toContain("# excluded");
      expect(content).not.toContain("excluded output");
    });

    // examples + formatter: formatter should be applied after examples output
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
          [filePath]: [""],
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

    // examples without examples config (should not execute examples)
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
          [filePath]: [""],
        },
        // No examples config - examples should not be executed
      });

      expect(result.success).toBe(true);
      expect(executionCount).toBe(0); // run should not have been called

      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# no-config-cli");
      // Examples section should still exist (showing example definitions)
      expect(content).toContain("Examples");
      // But the output should not be captured
      expect(content).not.toContain("should not be executed");
    });
  });

  describe("targetCommands", () => {
    it("should validate only the target command section", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      // Create file with all commands
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Validate only greet command - should match
      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should update only the target command section", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      // Create initial file
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
      });

      // Read original content
      const originalContent = fs.readFileSync(filePath, "utf-8");
      expect(originalContent).toContain("<!-- politty:command:greet:heading:start -->");

      // Manually modify the greet heading section in the file
      // greet is depth=2 (subcommand), so it gets ## heading
      const modifiedContent = originalContent.replace(
        /<!-- politty:command:greet:heading:start -->\n## greet/,
        "<!-- politty:command:greet:heading:start -->\n## MODIFIED greet",
      );
      fs.writeFileSync(filePath, modifiedContent, "utf-8");

      // Update only greet command
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
        targetCommands: ["greet"],
      });

      // Verify greet section was restored but other sections remain
      const updatedContent = fs.readFileSync(filePath, "utf-8");
      // greet is depth=2 (subcommand), so it gets ## heading
      expect(updatedContent).toContain("<!-- politty:command:greet:heading:start -->\n## greet");
      expect(updatedContent).not.toContain("## MODIFIED greet");
    });

    it("should throw error for invalid target command", async () => {
      const filePath = path.join(testDir, "cli.md");

      await expect(
        generateDoc({
          command: testCommand,
          files: { [filePath]: [""] },
          targetCommands: ["nonexistent"],
        }),
      ).rejects.toThrow('Target command "nonexistent" not found');
    });

    it("should validate multiple target commands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      // Create file with all commands
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Validate multiple commands - should match
      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
        targetCommands: ["greet", "config"],
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should update multiple target command sections", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      // Create initial file
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
      });

      // Read original content
      const originalContent = fs.readFileSync(filePath, "utf-8");

      // Manually modify both greet and config heading sections in the file
      // greet and config are depth=2 (subcommands), so they get ## heading
      let modifiedContent = originalContent.replace(
        /<!-- politty:command:greet:heading:start -->\n## greet/,
        "<!-- politty:command:greet:heading:start -->\n## MODIFIED greet",
      );
      modifiedContent = modifiedContent.replace(
        /<!-- politty:command:config:heading:start -->\n## config/,
        "<!-- politty:command:config:heading:start -->\n## MODIFIED config",
      );
      fs.writeFileSync(filePath, modifiedContent, "utf-8");

      // Update both commands
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
        targetCommands: ["greet", "config"],
      });

      // Verify both sections were restored
      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain("<!-- politty:command:greet:heading:start -->\n## greet");
      expect(updatedContent).toContain("<!-- politty:command:config:heading:start -->\n## config");
      expect(updatedContent).not.toContain("## MODIFIED greet");
      expect(updatedContent).not.toContain("## MODIFIED config");
    });

    it("should handle target commands across multiple files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const mainPath = path.join(testDir, "main.md");
      const configPath = path.join(testDir, "config.md");

      // Create files with commands split across them
      await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: ["", "greet"],
          [configPath]: ["config"],
        },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Validate commands from different files
      const result = await generateDoc({
        command: testCommand,
        files: {
          [mainPath]: ["", "greet"],
          [configPath]: ["config"],
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
          [targetPath]: ["greet"],
          [otherPath]: ["config"],
        },
      });

      // Modify the other file to have outdated content
      const otherContent = fs.readFileSync(otherPath, "utf-8");
      fs.writeFileSync(otherPath, otherContent.replace("## config", "## MODIFIED config"), "utf-8");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        files: {
          [targetPath]: ["greet"],
          [otherPath]: ["config"],
        },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(true);
      expect(result.files).toHaveLength(1);
      expect(result.files[0]?.path).toBe(targetPath);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should respect section opt-out by not re-inserting removed markers", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "opt-out.md");

      // Create initial file with all sections
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
      });

      // Read the generated content and remove the description marker for greet
      const originalContent = fs.readFileSync(filePath, "utf-8");
      expect(originalContent).toContain("<!-- politty:command:greet:description:start -->");

      // Remove the description section marker block for greet (opt-out)
      const optedOutContent = removeSectionBlock(originalContent, "description", "greet");
      fs.writeFileSync(filePath, optedOutContent, "utf-8");

      // Run update targeting greet
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
        targetCommands: ["greet"],
      });

      // Verify: the description marker was NOT re-inserted (opt-out respected)
      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).not.toContain("<!-- politty:command:greet:description:start -->");
      expect(updatedContent).not.toContain("<!-- politty:command:greet:description:end -->");

      // Other sections for greet should still be present
      expect(updatedContent).toContain("<!-- politty:command:greet:heading:start -->");
      expect(updatedContent).toContain("<!-- politty:command:greet:usage:start -->");
    });

    it("should insert new subcommand at correct position when parent is in targetCommands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "config.md");

      // Step 1: Generate initial doc with config command (has get & set subcommands)
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["config"] },
      });

      const initialContent = fs.readFileSync(filePath, "utf-8");
      expect(initialContent).toContain("<!-- politty:command:config get:heading:start -->");
      expect(initialContent).toContain("<!-- politty:command:config set:heading:start -->");

      // Step 2: Create an extended command with a new "delete" subcommand
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

      // Step 3: Run generateDoc with targetCommands pointing to parent "config"
      // This should auto-expand to include "config delete" as a new subcommand
      await generateDoc({
        command: extendedCommand,
        files: { [filePath]: ["config"] },
        targetCommands: ["config"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");

      // Step 4: Verify the new subcommand section was inserted
      expect(updatedContent).toContain("<!-- politty:command:config delete:heading:start -->");

      // Step 5: Verify correct ordering — alphabetical: delete < get < set
      const deletePos = updatedContent.indexOf(
        "<!-- politty:command:config delete:heading:start -->",
      );
      const getPos = updatedContent.indexOf("<!-- politty:command:config get:heading:start -->");
      const setPos = updatedContent.indexOf("<!-- politty:command:config set:heading:start -->");

      expect(deletePos).toBeLessThan(getPos);
      expect(getPos).toBeLessThan(setPos);
    });

    it("should report success in read-only mode when sections are opted out", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "opt-out-readonly.md");

      // Create initial file with all sections
      await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
      });

      // Remove the description section marker block for greet (opt-out)
      const originalContent = fs.readFileSync(filePath, "utf-8");
      const optedOutContent = removeSectionBlock(originalContent, "description", "greet");
      fs.writeFileSync(filePath, optedOutContent, "utf-8");

      // Switch to read-only mode
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Validate targeting greet — should succeed (opted-out sections should not cause diff)
      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: ["", "greet", "config"] },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });
  });

  describe("doctor mode", () => {
    const filesConfig = { commands: ["", "greet", "config"] };

    /** Generate a doc file, remove a section marker, and return the file path. */
    async function setupWithMissingMarker(
      fileName: string,
      sectionType: SectionType,
      scope: string,
    ): Promise<string> {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      vi.stubEnv(DOCTOR_ENV, "");

      const filePath = path.join(testDir, fileName);
      await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
      });

      const content = fs.readFileSync(filePath, "utf-8");
      fs.writeFileSync(filePath, removeSectionBlock(content, sectionType, scope), "utf-8");

      // Reset env to neutral state so callers start from a clean slate
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      vi.stubEnv(DOCTOR_ENV, "");

      return filePath;
    }

    it("should detect missing section markers in read-only mode", async () => {
      const filePath = await setupWithMissingMarker("doctor-detect.md", "description", "greet");

      // Without doctor mode: should succeed (opt-out respected)
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      const resultNormal = await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
        targetCommands: ["greet"],
      });
      expect(resultNormal.success).toBe(true);

      // With doctor mode: should report missing marker
      vi.stubEnv(DOCTOR_ENV, "true");
      const resultDoctor = await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
        targetCommands: ["greet"],
      });
      expect(resultDoctor.success).toBe(false);
      expect(resultDoctor.files[0]?.diff).toContain("[doctor] Missing section marker");
      expect(resultDoctor.files[0]?.diff).toContain("description");
      expect(resultDoctor.files[0]?.diff).toContain("greet");
    });

    it("should insert missing section markers in update+doctor mode", async () => {
      const filePath = await setupWithMissingMarker("doctor-insert.md", "description", "greet");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      vi.stubEnv(DOCTOR_ENV, "true");
      await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
        targetCommands: ["greet"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain("<!-- politty:command:greet:description:start -->");
      expect(updatedContent).toContain("<!-- politty:command:greet:description:end -->");
      expect(updatedContent).toContain("Greet someone");

      // Verify marker order: heading < description < usage
      const headingPos = updatedContent.indexOf("<!-- politty:command:greet:heading:start -->");
      const descPos = updatedContent.indexOf("<!-- politty:command:greet:description:start -->");
      const usagePos = updatedContent.indexOf("<!-- politty:command:greet:usage:start -->");
      expect(headingPos).toBeLessThan(descPos);
      expect(descPos).toBeLessThan(usagePos);
    });

    it("should not insert markers without doctor mode (opt-out respected)", async () => {
      const filePath = await setupWithMissingMarker("doctor-no-insert.md", "description", "greet");

      await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
        targetCommands: ["greet"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).not.toContain("<!-- politty:command:greet:description:start -->");
    });

    it("should insert missing heading marker at the start of command section", async () => {
      const filePath = await setupWithMissingMarker("doctor-heading.md", "heading", "greet");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      vi.stubEnv(DOCTOR_ENV, "true");
      await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
        targetCommands: ["greet"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain("<!-- politty:command:greet:heading:start -->");
      expect(updatedContent).toContain("<!-- politty:command:greet:heading:end -->");

      // Verify marker order: heading < description
      const headingPos = updatedContent.indexOf("<!-- politty:command:greet:heading:start -->");
      const descPos = updatedContent.indexOf("<!-- politty:command:greet:description:start -->");
      expect(headingPos).toBeLessThan(descPos);

      // Verify no excessive blank lines before the heading marker
      const beforeHeading = updatedContent.slice(0, headingPos);
      expect(beforeHeading).not.toMatch(/\n{3,}$/);
    });

    it("should not produce excessive blank lines when inserting after a preceding section", async () => {
      const filePath = await setupWithMissingMarker("doctor-mid-insert.md", "usage", "greet");

      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      vi.stubEnv(DOCTOR_ENV, "true");
      await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
        targetCommands: ["greet"],
      });

      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).toContain("<!-- politty:command:greet:usage:start -->");

      // Verify marker order: description < usage < arguments
      const descPos = updatedContent.indexOf("<!-- politty:command:greet:description:start -->");
      const usagePos = updatedContent.indexOf("<!-- politty:command:greet:usage:start -->");
      const argsPos = updatedContent.indexOf("<!-- politty:command:greet:arguments:start -->");
      expect(descPos).toBeLessThan(usagePos);
      if (argsPos !== -1) {
        expect(usagePos).toBeLessThan(argsPos);
      }

      // Verify no triple+ newlines anywhere in the content
      expect(updatedContent).not.toMatch(/\n{3,}/);
    });

    it("should detect multiple missing section markers in read-only doctor mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      vi.stubEnv(DOCTOR_ENV, "");

      const filePath = path.join(testDir, "doctor-multi-missing.md");
      await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
      });

      // Remove both description and usage sections for greet
      let content = fs.readFileSync(filePath, "utf-8");
      content = removeSectionBlock(content, "description", "greet");
      content = removeSectionBlock(content, "usage", "greet");
      fs.writeFileSync(filePath, content, "utf-8");

      // Read-only doctor mode should report both missing markers
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      vi.stubEnv(DOCTOR_ENV, "true");
      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: filesConfig },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(false);
      const diff = result.files[0]?.diff ?? "";
      expect(diff).toContain('[doctor] Missing section marker "description"');
      expect(diff).toContain('[doctor] Missing section marker "usage"');
      // Verify hint message mentions both env vars for correct remediation
      expect(diff).toContain("POLITTY_DOCS_DOCTOR=true");
      expect(diff).toContain("POLITTY_DOCS_UPDATE=true");
    });
  });

  describe("assertDocMatch", () => {
    it("should not throw when documentation matches", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");

      // Create the file first
      await generateDoc({
        command: testCommand,
        files: { [filePath]: [""] },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // Should not throw
      await expect(
        assertDocMatch({
          command: testCommand,
          files: { [filePath]: [""] },
        }),
      ).resolves.toBeUndefined();
    });

    it("should throw when documentation does not match", async () => {
      // Ensure update mode is disabled for this test
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const filePath = path.join(testDir, "cli.md");
      fs.writeFileSync(filePath, "# Wrong content\n", "utf-8");

      await expect(
        assertDocMatch({
          command: testCommand,
          files: { [filePath]: [""] },
        }),
      ).rejects.toThrow("Documentation does not match golden files");
    });

    it("should update files in update mode instead of throwing", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "cli.md");
      fs.writeFileSync(filePath, "# Wrong content\n", "utf-8");

      // Should not throw in update mode
      await expect(
        assertDocMatch({
          command: testCommand,
          files: { [filePath]: [""] },
        }),
      ).resolves.toBeUndefined();

      // File should be updated
      const content = fs.readFileSync(filePath, "utf-8");
      expect(content).toContain("# test-cli");
    });

    it("should include marker diff details when update mode still has unresolved marker errors", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "assert-doc-match-marker-error.md");
      const refPath = path.join(testDir, "assert-doc-match-marker-ref.md");

      await generateDoc({
        command: testCommand,
        files: {
          [filePath]: ["greet"],
        },
      });

      // Create a rootDoc file without the expected marker
      fs.writeFileSync(refPath, "# test-cli\n\nNo markers here.\n", "utf-8");

      await expect(
        assertDocMatch({
          command: testCommand,
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
            [filePath]: ["greet"],
          },
        }),
      ).rejects.toThrow("Global options marker not found");
    });
  });

  describe("rootDoc globalOptions markers", () => {
    it("should validate globalOptions marker section", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "args-test.md");

      // Generate the expected args content
      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      // Create a file with the correct globalOptions marker content
      const initialContent = `# test-cli

A test CLI for documentation generation

## Global Options

<!-- politty:global-options:start -->
<a id="global-options"></a>
${argsContent}
<!-- politty:global-options:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      // Validate the globalOptions marker
      const result = await generateDoc({
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
        files: {},
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("should update globalOptions marker section when content differs", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "args-update.md");

      // Create a file with outdated globalOptions marker content
      const initialContent = `# test-cli

A test CLI for documentation generation

## Global Options

<!-- politty:global-options:start -->
| Option | Alias | Description | Default |
| ------ | ----- | ----------- | ------- |
| \`--old-option\` | - | Old description | - |
<!-- politty:global-options:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      // Update the globalOptions marker
      const result = await generateDoc({
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
        files: {},
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("updated");

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toContain("--verbose");
      expect(content).toContain("Enable verbose output");
      expect(content).not.toContain("--old-option");
    });

    it("should report diff when globalOptions marker section differs in check mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "args-diff.md");

      // Create a file with outdated globalOptions marker content
      const initialContent = `# test-cli

A test CLI for documentation generation

## Global Options

<!-- politty:global-options:start -->
| Option | Alias | Description | Default |
| ------ | ----- | ----------- | ------- |
| \`--old-option\` | - | Old description | - |
<!-- politty:global-options:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      // Check the globalOptions marker (should report diff)
      const result = await generateDoc({
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
        files: {},
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");
      expect(result.files[0]?.diff).toBeDefined();
    });

    it("should report error when globalOptions marker is missing", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "args-missing.md");

      // Create a file without the expected marker
      const initialContent = `# test-cli

A test CLI for documentation generation

## Global Options

Some content without markers.
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      // Check the globalOptions marker (should report error)
      const result = await generateDoc({
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
        files: {},
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");
      expect(result.files[0]?.diff).toContain("Global options marker not found");
    });

    it("should support shorthand args config (without options)", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "args-shorthand.md");

      // Create a file with globalOptions marker
      const initialContent = `# test-cli

A test CLI for documentation generation

<!-- politty:global-options:start -->
outdated
<!-- politty:global-options:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      // Use shorthand config (just ArgsShape, not { args, options })
      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          globalOptions: {
            debug: arg(z.boolean().default(false), {
              description: "Enable debug mode",
            }),
          },
        },
        files: {},
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("updated");

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toContain("--debug");
      expect(content).toContain("Enable debug mode");
    });

    it("should handle shorthand args config with option named 'args'", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "args-named-args.md");

      // Create a file with globalOptions marker
      const initialContent = `# test-cli

A test CLI for documentation generation

<!-- politty:global-options:start -->
outdated
<!-- politty:global-options:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      // Use shorthand config with an option literally named "args"
      // This should NOT be confused with { args: ArgsShape, options?: ... } shape
      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          globalOptions: {
            args: arg(z.boolean().default(false), {
              description: "Show arguments",
            }),
            verbose: arg(z.boolean().default(false), {
              alias: "v",
              description: "Enable verbose output",
            }),
          },
        },
        files: {},
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("updated");

      const content = fs.readFileSync(rootDocPath, "utf-8");
      // Both options should be rendered
      expect(content).toContain("--args");
      expect(content).toContain("Show arguments");
      expect(content).toContain("--verbose");
      expect(content).toContain("Enable verbose output");
    });

    it("should handle ArgsConfigWithOptions when args include def/_def keys", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "args-with-def-keys.md");

      const initialContent = `# test-cli

A test CLI for documentation generation

<!-- politty:global-options:start -->
outdated
<!-- politty:global-options:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          globalOptions: {
            args: {
              def: arg(z.boolean().default(false), {
                description: "Enable def option",
              }),
              _def: arg(z.boolean().default(false), {
                description: "Enable _def option",
              }),
            },
            options: {
              columns: ["option", "description"],
            },
          },
        },
        files: {},
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("updated");

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toContain("--def");
      expect(content).toContain("--_def");
      expect(content).toContain("Enable def option");
      expect(content).toContain("Enable _def option");
      expect(content).not.toContain("| Alias |");
    });
  });

  describe("rootDoc index markers", () => {
    it("should auto-derive index from files and validate", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "index-test.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      // First generate the expected index content using derived categories
      const categories = [
        {
          title: "greet",
          description: "Greet someone",
          commands: ["greet"],
          docPath: "./cli/greet.md",
        },
      ];

      const indexContent = await renderCommandIndex(testCommand, categories);

      const initialContent = `# test-cli

A test CLI for documentation generation

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
${indexContent}
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
        },
        files: {
          [greetPath]: ["greet"],
        },
      });

      expect(result.success).toBe(true);
      expect(result.files.find((f) => f.path === rootDocPath)?.status).toBe("match");
    });

    it("should expand wildcard file commands when deriving rootDoc index", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "index-wildcard.md");
      const allPath = path.join(testDir, "cli", "all.md");

      const categories = [
        {
          title: "greet",
          description: "Greet someone",
          commands: ["greet", "config"],
          docPath: "./cli/all.md",
        },
      ];

      const indexContent = await renderCommandIndex(testCommand, categories);

      const initialContent = `# test-cli

A test CLI for documentation generation

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
${indexContent}
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
        },
        files: {
          [allPath]: ["*"],
        },
      });

      expect(result.success).toBe(true);
      expect(result.files.find((f) => f.path === rootDocPath)?.status).toBe("match");
    });

    it("should update index marker section when content differs", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "index-update.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      // Create a file with outdated index marker content
      const initialContent = `# test-cli

A test CLI for documentation generation

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
### [Old Category](./old.md)

Old description.

| Command | Description |
|---------|-------------|
| [old](./old.md#old) | Old command |
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
        },
        files: {
          [greetPath]: ["greet"],
        },
      });

      expect(result.success).toBe(true);
      const rootDocResult = result.files.find((f) => f.path === rootDocPath);
      expect(rootDocResult?.status).toBe("updated");

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toContain("greet");
      expect(content).toContain("Greet someone");
      expect(content).not.toContain("Old Category");
    });

    it("should skip index processing when no index marker is present", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "no-index-marker.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      // Create a rootDoc file with globalOptions but no index marker
      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      const initialContent = `# test-cli

A test CLI for documentation generation

<!-- politty:global-options:start -->
${argsContent}
<!-- politty:global-options:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
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
          [greetPath]: ["greet"],
        },
      });

      // Should succeed without error — no index marker to validate
      expect(result.success).toBe(true);
    });

    it("should report malformed index markers in rootDoc", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "malformed-index-marker.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      const initialContent = `# test-cli

A test CLI for documentation generation

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
### Broken section without end marker
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
        },
        files: {
          [greetPath]: ["greet"],
        },
      });

      expect(result.success).toBe(false);
      const rootDocResult = result.files.find((f) => f.path === rootDocPath);
      expect(rootDocResult?.status).toBe("diff");
      expect(rootDocResult?.diff).toContain("Index marker section is malformed");
    });

    it("should report diff when index marker differs in check mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "index-diff.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      const initialContent = `# test-cli

A test CLI for documentation generation

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
### [Old Category](./old.md)

Old description.
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
        },
        files: {
          [greetPath]: ["greet"],
        },
      });

      expect(result.success).toBe(false);
      const rootDocResult = result.files.find((f) => f.path === rootDocPath);
      expect(rootDocResult?.status).toBe("diff");
      expect(rootDocResult?.diff).toBeDefined();
    });

    it("should validate index marker even when derived categories are empty", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "index-empty-categories.md");
      const skippedPath = path.join(testDir, "cli", "skipped.md");

      const initialContent = `# test-cli

A test CLI for documentation generation

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
### [Old Category](./old.md)

Old description.
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
        },
        files: {
          [skippedPath]: [],
        },
      });

      expect(result.success).toBe(false);
      const rootDocResult = result.files.find((f) => f.path === rootDocPath);
      expect(rootDocResult?.status).toBe("diff");
      expect(rootDocResult?.diff).toBeDefined();
    });

    it("should use FileConfig.title and description for index category", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "index-fileconfig.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      // FileConfig with custom title and description
      const categories = [
        {
          title: "Custom Title",
          description: "Custom description for the category",
          commands: ["greet"],
          docPath: "./cli/greet.md",
        },
      ];

      const indexContent = await renderCommandIndex(testCommand, categories);

      const initialContent = `# test-cli

A test CLI for documentation generation

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
${indexContent}
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
        },
        files: {
          [greetPath]: {
            commands: ["greet"],
            title: "Custom Title",
            description: "Custom description for the category",
          },
        },
      });

      expect(result.success).toBe(true);
      expect(result.files.find((f) => f.path === rootDocPath)?.status).toBe("match");
    });
  });

  describe("rootDoc combined globalOptions and index markers", () => {
    it("should validate both globalOptions and index markers in rootDoc", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "combined-test.md");
      const allPath = path.join(testDir, "cli", "all.md");

      const categories = [
        {
          title: "greet",
          description: "Greet someone",
          commands: ["greet", "config"],
          docPath: "./cli/all.md",
        },
      ];

      const indexContent = await renderCommandIndex(testCommand, categories);
      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      const initialContent = `# test-cli

A test CLI for documentation generation

## Global Options

<!-- politty:global-options:start -->
<a id="global-options"></a>
${argsContent}
<!-- politty:global-options:end -->

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
${indexContent}
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
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
          [allPath]: ["greet", "config"],
        },
      });

      expect(result.success).toBe(true);
      expect(result.files.find((f) => f.path === rootDocPath)?.status).toBe("match");
    });

    it("should update both globalOptions and index markers when both differ", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "combined-update.md");
      const greetPath = path.join(testDir, "cli", "greet.md");

      const initialContent = `# test-cli

A test CLI for documentation generation

## Global Options

<!-- politty:global-options:start -->
outdated args
<!-- politty:global-options:end -->

## Commands

<!-- politty:index:${relPath(rootDocPath)}:start -->
outdated index
<!-- politty:index:${relPath(rootDocPath)}:end -->
`;
      fs.writeFileSync(rootDocPath, initialContent, "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          globalOptions: {
            debug: arg(z.boolean().default(false), {
              description: "Enable debug mode",
            }),
          },
        },
        files: {
          [greetPath]: ["greet"],
        },
      });

      expect(result.success).toBe(true);
      expect(result.files.find((f) => f.path === rootDocPath)?.status).toBe("updated");

      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toContain("--debug");
      expect(content).toContain("Enable debug mode");
      expect(content).toContain("greet");
      expect(content).not.toContain("outdated");
    });
  });

  describe("rootDoc header derived from command", () => {
    it("should report diff when rootDoc file header differs", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "rootdoc-header-diff.md");

      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      fs.writeFileSync(
        rootDocPath,
        `# Outdated Title

Outdated description.

<!-- politty:global-options:start -->
${argsContent}
<!-- politty:global-options:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
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
        files: {},
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");
      expect(result.files[0]?.diff).toContain("test-cli");
      expect(result.files[0]?.diff).toContain("Outdated Title");
    });

    it("should update rootDoc file header from command name/description", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "rootdoc-header-update.md");

      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      fs.writeFileSync(
        rootDocPath,
        `# Outdated Title

Outdated description.

<!-- politty:global-options:start -->
${argsContent}
<!-- politty:global-options:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
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
        files: {},
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("updated");

      const updatedContent = fs.readFileSync(rootDocPath, "utf-8");
      expect(updatedContent).toContain("# test-cli");
      expect(updatedContent).toContain("A test CLI for documentation generation");
      expect(updatedContent).not.toContain("# Outdated Title");
      expect(updatedContent).not.toContain("Outdated description.");
    });

    it("should treat empty rootDoc as existing and update header in update mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "rootdoc-empty.md");
      fs.writeFileSync(rootDocPath, "", "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath },
        files: {},
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("updated");

      const updatedContent = fs.readFileSync(rootDocPath, "utf-8");
      expect(updatedContent).toContain("# test-cli");
      expect(updatedContent).toContain("A test CLI for documentation generation");
    });

    it("should detect unexpected section markers in rootDoc", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const rootDocPath = path.join(testDir, "rootdoc-unexpected-cmd.md");

      fs.writeFileSync(
        rootDocPath,
        `# test-cli

A test CLI for documentation generation

<!-- politty:command:config:heading:start -->
## stale config
<!-- politty:command:config:heading:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath },
        files: {},
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");
      expect(result.files[0]?.diff).toContain("unexpected section markers in rootDoc");
      expect(result.files[0]?.diff).toContain("config");
    });

    it("should remove unexpected section markers in rootDoc in update mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "rootdoc-remove-stale.md");

      fs.writeFileSync(
        rootDocPath,
        `# test-cli

A test CLI for documentation generation

<!-- politty:command:config:heading:start -->
## stale config
<!-- politty:command:config:heading:end -->

<!-- politty:command:config:description:start -->
Stale description
<!-- politty:command:config:description:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath },
        files: {},
      });

      expect(result.success).toBe(true);
      const updatedContent = fs.readFileSync(rootDocPath, "utf-8");
      expect(updatedContent).not.toContain("politty:command:config");
      expect(updatedContent).not.toContain("stale config");
      expect(updatedContent).toContain("# test-cli");
    });

    it("should remove orphaned section markers for deleted commands in files", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "file-remove-orphan.md");

      // Write a file with markers for "greet" (exists) and "removed" (doesn't exist)
      fs.writeFileSync(
        filePath,
        `<!-- politty:command:greet:heading:start -->
## greet
<!-- politty:command:greet:heading:end -->

<!-- politty:command:removed:heading:start -->
## removed command
<!-- politty:command:removed:heading:end -->

<!-- politty:command:removed:description:start -->
This command was removed
<!-- politty:command:removed:description:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: ["greet"] },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(true);
      const updatedContent = fs.readFileSync(filePath, "utf-8");
      expect(updatedContent).not.toContain("politty:command:removed");
      expect(updatedContent).not.toContain("removed command");
      expect(updatedContent).toContain("politty:command:greet");
    });

    it("should detect orphaned section markers for deleted commands in validation mode", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const filePath = path.join(testDir, "file-detect-orphan.md");

      fs.writeFileSync(
        filePath,
        `<!-- politty:command:greet:heading:start -->
## \`greet\`
<!-- politty:command:greet:heading:end -->

<!-- politty:command:greet:description:start -->
Greet someone
<!-- politty:command:greet:description:end -->

<!-- politty:command:greet:usage:start -->
\`\`\`
test-cli greet <name>
\`\`\`
<!-- politty:command:greet:usage:end -->

<!-- politty:command:greet:arguments:start -->
| Argument | Description |
| --- | --- |
| \`name\` | Name to greet |
<!-- politty:command:greet:arguments:end -->

<!-- politty:command:removed:heading:start -->
## removed
<!-- politty:command:removed:heading:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: ["greet"] },
        targetCommands: ["greet"],
      });

      expect(result.success).toBe(false);
      expect(result.files[0]?.diff).toContain("orphaned section markers");
      expect(result.files[0]?.diff).toContain("removed");
    });
  });

  describe("rootDoc custom heading levels", () => {
    it("should generate file header with custom heading level", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "rootdoc-heading-level.md");
      fs.writeFileSync(rootDocPath, "", "utf-8");

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath, headingLevel: 2 },
        files: {},
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toMatch(/^## test-cli$/m);
      expect(content).not.toMatch(/^# test-cli$/m);
    });

    it("should generate index section with custom heading level", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "rootdoc-index-level.md");
      const filePath = path.join(testDir, "rootdoc-index-level-cmds.md");

      fs.writeFileSync(
        rootDocPath,
        `# test-cli

A test CLI for documentation generation

<!-- politty:index:${relPath(rootDocPath)}:start -->
<!-- politty:index:${relPath(rootDocPath)}:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath, index: { headingLevel: 4 } },
        files: {
          [filePath]: ["greet", "config"],
        },
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toMatch(/^#### \[/m);
      expect(content).not.toMatch(/^### \[/m);
    });

    it("should customize both header and index heading levels", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "rootdoc-both-levels.md");
      const filePath = path.join(testDir, "rootdoc-both-levels-cmds.md");

      fs.writeFileSync(
        rootDocPath,
        `## test-cli

A test CLI for documentation generation

<!-- politty:index:${relPath(rootDocPath)}:start -->
<!-- politty:index:${relPath(rootDocPath)}:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath, headingLevel: 2, index: { headingLevel: 4 } },
        files: {
          [filePath]: ["greet", "config"],
        },
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toMatch(/^## test-cli$/m);
      expect(content).toMatch(/^#### \[/m);
    });

    it("should default to heading level 1 and index level 3 when not specified", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootDocPath = path.join(testDir, "rootdoc-default-levels.md");
      const filePath = path.join(testDir, "rootdoc-default-levels-cmds.md");

      fs.writeFileSync(
        rootDocPath,
        `# test-cli

A test CLI for documentation generation

<!-- politty:index:${relPath(rootDocPath)}:start -->
<!-- politty:index:${relPath(rootDocPath)}:end -->
`,
        "utf-8",
      );

      const result = await generateDoc({
        command: testCommand,
        rootDoc: { path: rootDocPath },
        files: {
          [filePath]: ["greet", "config"],
        },
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(rootDocPath, "utf-8");
      expect(content).toMatch(/^# test-cli$/m);
      expect(content).toMatch(/^### \[/m);
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
            [filePath]: ["greet"],
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
            [equivalentPath]: ["greet"],
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

    it("should exclude globalOptions marker options from command option tables", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
        env: arg(z.string().default("development"), {
          alias: "e",
          description: "Target environment",
        }),
      });

      // Create reference file with globalOptions marker
      fs.writeFileSync(
        refPath,
        `# shared-cli\n\nCLI with shared options\n\n<!-- politty:global-options:start -->\n${argsContent}\n<!-- politty:global-options:end -->\n`,
        "utf-8",
      );

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
          [readmePath]: ["build", "deploy"],
        },
      });

      expect(result.success).toBe(true);

      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      // verbose and env should be excluded from command option tables
      expect(readmeContent).not.toContain("--verbose");
      expect(readmeContent).not.toContain("--env");
      // watch and force should remain
      expect(readmeContent).toContain("--watch");
      expect(readmeContent).toContain("--force");
    });

    it("should keep all options in globalOptions marker table", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      // Create reference file with globalOptions marker
      fs.writeFileSync(
        refPath,
        `# shared-cli\n\nCLI with shared options\n\n<!-- politty:global-options:start -->\n${argsContent}\n<!-- politty:global-options:end -->\n`,
        "utf-8",
      );

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
          [readmePath]: ["build"],
        },
      });

      expect(result.success).toBe(true);

      // Global options marker table should still contain verbose
      const refContent = fs.readFileSync(refPath, "utf-8");
      expect(refContent).toContain("--verbose");
      expect(refContent).toContain("Enable verbose output");
    });

    it("should pass filtered CommandInfo to custom render function", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      fs.writeFileSync(
        refPath,
        `# shared-cli\n\nCLI with shared options\n\n<!-- politty:global-options:start -->\n${argsContent}\n<!-- politty:global-options:end -->\n`,
        "utf-8",
      );

      const capturedOptions: string[][] = [];

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
            commands: ["build"],
            render: (info) => {
              capturedOptions.push(info.options.map((o) => o.name));
              return `# ${info.name}\n`;
            },
          },
        },
      });

      expect(result.success).toBe(true);
      // Custom render should receive filtered options (verbose excluded)
      expect(capturedOptions.length).toBeGreaterThan(0);
      const buildOptions = capturedOptions[0]!;
      expect(buildOptions).not.toContain("verbose");
      expect(buildOptions).toContain("env");
      expect(buildOptions).toContain("watch");
    });

    it("should not exclude options when no rootDoc globalOptions exist", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const filePath = path.join(testDir, "no-args.md");

      const result = await generateDoc({
        command: commandWithSharedOptions,
        files: {
          [filePath]: ["build"],
        },
      });

      expect(result.success).toBe(true);

      const content = fs.readFileSync(filePath, "utf-8");
      // All options should be present
      expect(content).toContain("--verbose");
      expect(content).toContain("--env");
      expect(content).toContain("--watch");
    });

    it("should handle ArgsConfigWithOptions shape for exclusion", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      fs.writeFileSync(
        refPath,
        `# shared-cli\n\nCLI with shared options\n\n<!-- politty:global-options:start -->\n${argsContent}\n<!-- politty:global-options:end -->\n`,
        "utf-8",
      );

      // Use the { args, options } shape
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
          [readmePath]: ["build"],
        },
      });

      expect(result.success).toBe(true);

      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      // verbose should be excluded (even though using { args, options } shape)
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

      const argsContent = renderArgsTable({
        name: arg(z.string(), {
          positional: true,
          description: "Resource name positional argument",
        }),
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      fs.writeFileSync(
        refPath,
        `# positional-marker-cli

CLI for positional marker exclusion tests

<!-- politty:global-options:start -->
${argsContent}
<!-- politty:global-options:end -->
`,
        "utf-8",
      );

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
          [readmePath]: ["create"],
        },
      });

      expect(result.success).toBe(true);

      const readmeContent = fs.readFileSync(readmePath, "utf-8");
      const refContent = fs.readFileSync(refPath, "utf-8");

      // Positional args in marker config should not exclude command options.
      expect(readmeContent).toContain("--name");
      // Non-positional marker args should still be excluded.
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
            [readmePath]: ["build", "deploy"],
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

      const argsContent = renderArgsTable({
        output: arg(z.string().default("dist"), {
          alias: "o",
          description: "Output directory",
        }),
      });

      fs.writeFileSync(
        refPath,
        `# target-conflict-cli

CLI with target-only conflict behavior

<!-- politty:global-options:start -->
${argsContent}
<!-- politty:global-options:end -->
`,
        "utf-8",
      );

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
          [targetPath]: ["build"],
          [nonTargetPath]: ["deploy"],
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

      const argsContent = renderArgsTable({
        output: arg(z.string().default("dist"), {
          alias: "o",
          description: "Output directory",
        }),
      });

      fs.writeFileSync(
        refPath,
        `# partial-doc-cli

CLI with partially documented commands

<!-- politty:global-options:start -->
${argsContent}
<!-- politty:global-options:end -->
`,
        "utf-8",
      );

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
          [readmePath]: ["build"],
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
            [readmePath]: ["build", "deploy"],
          },
        }),
      ).rejects.toThrow('does not match globalOptions definition for "output"');
    });

    it("should process rootDoc with targetCommands", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const readmePath = path.join(testDir, "readme.md");
      const refPath = path.join(testDir, "reference.md");

      const argsContent = renderArgsTable({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose output",
        }),
      });

      fs.writeFileSync(
        refPath,
        `# shared-cli\n\nCLI with shared options\n\n<!-- politty:global-options:start -->\n${argsContent}\n<!-- politty:global-options:end -->\n`,
        "utf-8",
      );

      // First create the readme with all commands
      await generateDoc({
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
          [readmePath]: ["build", "deploy"],
        },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      // targetCommands should still process rootDoc
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
          [readmePath]: ["build", "deploy"],
        },
        targetCommands: ["build"],
      });

      expect(result.success).toBe(true);
      // Should have results for both target file and rootDoc
      expect(result.files.length).toBeGreaterThanOrEqual(2);
    });

    describe("stale options markers when globalOptions filtering empties command options", () => {
      const commandAllGlobal = defineCommand({
        name: "my-cli",
        description: "CLI tool",
        subCommands: {
          run: defineCommand({
            name: "run",
            description: "Run the task",
            args: z.object({
              json: arg(z.boolean().default(false), {
                description: "Output as JSON",
              }),
            }),
            run: () => {},
          }),
        },
      });

      const globalOptionsConfig = {
        json: arg(z.boolean().default(false), {
          description: "Output as JSON",
        }),
      };

      function setupRefFile(refPath: string) {
        const argsContent = renderArgsTable(globalOptionsConfig);
        fs.writeFileSync(
          refPath,
          `# my-cli\n\nCLI tool\n\n<!-- politty:global-options:start -->\n${argsContent}\n<!-- politty:global-options:end -->\n`,
          "utf-8",
        );
      }

      async function generateWithOptionsMarkers(readmePath: string, refPath: string) {
        await generateDoc({
          command: commandAllGlobal,
          rootDoc: { path: refPath },
          files: { [readmePath]: ["run"] },
        });
      }

      it("should clear options content in update mode", async () => {
        vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

        const readmePath = path.join(testDir, "readme.md");
        const refPath = path.join(testDir, "reference.md");
        setupRefFile(refPath);

        // Generate file WITHOUT globalOptions to create options markers with content
        await generateWithOptionsMarkers(readmePath, refPath);

        const initialContent = fs.readFileSync(readmePath, "utf-8");
        expect(initialContent).toContain("<!-- politty:command:run:options:start -->");
        expect(initialContent).toContain("--json");

        // Run with globalOptions that filter ALL command options
        await generateDoc({
          command: commandAllGlobal,
          rootDoc: { path: refPath, globalOptions: globalOptionsConfig },
          files: { [readmePath]: ["run"] },
          targetCommands: ["run"],
        });

        const updatedContent = fs.readFileSync(readmePath, "utf-8");
        // Markers remain (empty), but stale content is removed
        expect(updatedContent).toContain("<!-- politty:command:run:options:start -->");
        expect(updatedContent).toContain("<!-- politty:command:run:options:end -->");
        expect(updatedContent).not.toContain("--json");
      });

      it("should report diff in check mode", async () => {
        vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

        const readmePath = path.join(testDir, "readme.md");
        const refPath = path.join(testDir, "reference.md");
        setupRefFile(refPath);

        // Generate file WITHOUT globalOptions to create options markers with content
        await generateWithOptionsMarkers(readmePath, refPath);

        // Switch to check mode
        vi.stubEnv(UPDATE_GOLDEN_ENV, "");

        const result = await generateDoc({
          command: commandAllGlobal,
          rootDoc: { path: refPath, globalOptions: globalOptionsConfig },
          files: { [readmePath]: ["run"] },
          targetCommands: ["run"],
        });

        expect(result.success).toBe(false);
      });

      it("should restore options content when globalOptions are removed after clearing", async () => {
        vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

        const readmePath = path.join(testDir, "readme.md");
        const refPath = path.join(testDir, "reference.md");
        setupRefFile(refPath);

        // Step 1: Generate file WITHOUT globalOptions (options markers with content)
        await generateWithOptionsMarkers(readmePath, refPath);
        expect(fs.readFileSync(readmePath, "utf-8")).toContain("--json");

        // Step 2: Run with globalOptions → options content cleared
        await generateDoc({
          command: commandAllGlobal,
          rootDoc: { path: refPath, globalOptions: globalOptionsConfig },
          files: { [readmePath]: ["run"] },
          targetCommands: ["run"],
        });
        const clearedContent = fs.readFileSync(readmePath, "utf-8");
        expect(clearedContent).not.toContain("--json");

        // Step 3: Run WITHOUT globalOptions again → options content restored
        await generateDoc({
          command: commandAllGlobal,
          rootDoc: { path: refPath },
          files: { [readmePath]: ["run"] },
          targetCommands: ["run"],
        });
        const restoredContent = fs.readFileSync(readmePath, "utf-8");
        expect(restoredContent).toContain("<!-- politty:command:run:options:start -->");
        expect(restoredContent).toContain("--json");
      });
    });

    describe("stale section markers for non-options sections", () => {
      it("should clear examples content when examples are removed from command definition", async () => {
        vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

        const readmePath = path.join(testDir, "readme.md");

        const commandWithExamples = defineCommand({
          name: "my-cli",
          description: "CLI tool",
          subCommands: {
            run: defineCommand({
              name: "run",
              description: "Run the task",
              examples: [{ cmd: "--verbose", desc: "Run with verbose output" }],
              run: () => {},
            }),
          },
        });

        const commandWithoutExamples = defineCommand({
          name: "my-cli",
          description: "CLI tool",
          subCommands: {
            run: defineCommand({
              name: "run",
              description: "Run the task",
              run: () => {},
            }),
          },
        });

        // Step 1: Generate with examples
        await generateDoc({
          command: commandWithExamples,
          files: { [readmePath]: ["run"] },
        });

        const initialContent = fs.readFileSync(readmePath, "utf-8");
        expect(initialContent).toContain("<!-- politty:command:run:examples:start -->");
        expect(initialContent).toContain("Run with verbose output");

        // Step 2: Update with examples removed → content cleared, markers remain
        await generateDoc({
          command: commandWithoutExamples,
          files: { [readmePath]: ["run"] },
          targetCommands: ["run"],
        });

        const clearedContent = fs.readFileSync(readmePath, "utf-8");
        expect(clearedContent).toContain("<!-- politty:command:run:examples:start -->");
        expect(clearedContent).toContain("<!-- politty:command:run:examples:end -->");
        expect(clearedContent).not.toContain("Run with verbose output");

        // Step 3: Update with examples restored → content restored
        await generateDoc({
          command: commandWithExamples,
          files: { [readmePath]: ["run"] },
          targetCommands: ["run"],
        });

        const restoredContent = fs.readFileSync(readmePath, "utf-8");
        expect(restoredContent).toContain("<!-- politty:command:run:examples:start -->");
        expect(restoredContent).toContain("Run with verbose output");
      });

      it("should report diff in check mode when examples are removed", async () => {
        vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

        const readmePath = path.join(testDir, "readme.md");

        const commandWithExamples = defineCommand({
          name: "my-cli",
          description: "CLI tool",
          subCommands: {
            run: defineCommand({
              name: "run",
              description: "Run the task",
              examples: [{ cmd: "--verbose", desc: "Run with verbose output" }],
              run: () => {},
            }),
          },
        });

        const commandWithoutExamples = defineCommand({
          name: "my-cli",
          description: "CLI tool",
          subCommands: {
            run: defineCommand({
              name: "run",
              description: "Run the task",
              run: () => {},
            }),
          },
        });

        // Generate with examples
        await generateDoc({
          command: commandWithExamples,
          files: { [readmePath]: ["run"] },
        });

        // Switch to check mode
        vi.stubEnv(UPDATE_GOLDEN_ENV, "");

        // Check with examples removed — should report diff
        const result = await generateDoc({
          command: commandWithoutExamples,
          files: { [readmePath]: ["run"] },
          targetCommands: ["run"],
        });

        expect(result.success).toBe(false);
      });
    });
  });

  describe("PathConfig specificity", () => {
    it("should not duplicate descendant in ancestor file when descendant has own file", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootPath = path.join(testDir, "root.md");
      const configPath = path.join(testDir, "config.md");
      const getPath = path.join(testDir, "get.md");

      // 'config get' is explicitly assigned to get.md,
      // so it should NOT also appear in config.md (which gets 'config' and its remaining descendants)
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

      // 'config get' heading should only appear in get.md, not config.md
      expect(getContent).toContain("config get");
      // config.md should have 'config' and 'config set', but NOT 'config get'
      expect(configContent).toContain("config set");
      expect(configContent).not.toMatch(/## config get\b/);
    });
  });

  describe("rootInfo without globalArgs", () => {
    it("should apply rootInfo when path is specified without globalArgs", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");

      const rootPath = path.join(testDir, "root.md");

      await generateDoc({
        command: testCommand,
        path: rootPath,
        rootInfo: {
          title: "Custom Title",
          description: "Custom description for the CLI",
        },
      });

      const content = fs.readFileSync(rootPath, "utf-8");
      expect(content).toContain("# Custom Title");
      expect(content).toContain("Custom description for the CLI");
    });
  });

  describe("template mode", () => {
    it("creates output from template with handwritten text and command section", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(
        templatePath,
        "# My CLI Docs\n\nSome handwritten intro.\n\n{{politty:command}}\n\nSome handwritten footer.\n",
      );

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });

      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("created");
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("# My CLI Docs");
      expect(content).toContain("Some handwritten intro.");
      expect(content).toContain("Some handwritten footer.");
      expect(content).toContain("test-cli");
      // No politty markers in output
      expect(content).not.toContain("<!-- politty:");
    });

    it("typed placeholder renders only that section without markers", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      // {{politty:command::usage}} - root command usage section
      fs.writeFileSync(templatePath, "# Usage\n\n{{politty:command::usage}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("Usage");
      expect(content).not.toContain("<!-- politty:");
      expect(content).toContain("test-cli");
    });

    it("typed placeholder for missing section expands to empty without stray blank lines", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      // greet command has no examples
      fs.writeFileSync(templatePath, "Before\n\n{{politty:command:greet:examples}}\n\nAfter\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });

      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).not.toMatch(/\n{3,}/); // No 3+ consecutive newlines
      expect(content).not.toContain("<!-- politty:");
    });

    it("non-update mode with matching output succeeds", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "# Docs\n\n{{politty:command}}\n");

      await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });

      vi.stubEnv(UPDATE_GOLDEN_ENV, "");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      expect(result.files[0]?.status).toBe("match");
    });

    it("non-update mode with stale output fails and includes diff and path", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "# Docs\n\n{{politty:command}}\n");
      fs.writeFileSync(outputPath, "stale content\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");

      await expect(
        assertDocMatch({
          command: testCommand,
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow(outputPath);
    });

    it("subcommand scope placeholder renders that subcommand section", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "# Config Docs\n\n{{politty:command:config}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("config");
      expect(content).not.toContain("<!-- politty:");
    });

    it("unknown scope throws with available paths", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command:nonexistent}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow("nonexistent");
    });

    it("unknown type throws listing SECTION_TYPES", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command::badtype}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow(/Unknown section type "badtype".*Valid section types/);
    });

    it("unknown directive throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:unknown}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow("unknown");
    });

    it("malformed placeholder syntax throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command}\n");

      await expect(
        generateDoc({
          command: testCommand,
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow(/Malformed politty placeholder/);
    });

    it("missing template file gives error result in both modes", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "nonexistent-template.md");
      const outputPath = path.join(testDir, "output.md");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(false);
      expect(result.files[0]?.status).toBe("diff");
      expect(result.files[0]?.diff).toContain("Template file not found");

      // Also fails in check mode
      vi.stubEnv(UPDATE_GOLDEN_ENV, "");
      const result2 = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result2.success).toBe(false);
    });

    it("output path collision with files key throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          files: { [outputPath]: [""] },
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow();
    });

    it("output path equal to template source path throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(outputPath, "{{politty:command}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          templates: { [outputPath]: outputPath },
        }),
      ).rejects.toThrow();
    });

    it("global-options placeholder renders table and excludes from command options", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:global-options}}\n\n{{politty:command:greet}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
        globalArgs: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose output",
          }),
        }),
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("global-options");
      expect(content).not.toContain("<!-- politty:");
    });

    it("global-options placeholder without any global options config throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:global-options}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow("global-options");
    });

    it("index placeholder with templates and files includes both in categories", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const filePath = path.join(testDir, "greet.md");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:index}}\n");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: ["greet"] },
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      // Should contain a link to the greet file
      expect(content).toContain("greet");
      expect(content).not.toContain("<!-- politty:");
    });

    it("formatter is applied to the final output", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command::heading}}\n");

      const uppercaseFormatter = (content: string) => content.toUpperCase();

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
        formatter: uppercaseFormatter,
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toBe(content.toUpperCase());
    });

    it("initDocFile deletes output path but not template source", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command}}\n");
      fs.writeFileSync(outputPath, "old content\n");

      initDocFile({ templates: { [outputPath]: templatePath } });

      expect(fs.existsSync(outputPath)).toBe(false);
      expect(fs.existsSync(templatePath)).toBe(true);
    });

    it("templates combined with files both processed", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const filePath = path.join(testDir, "greet.md");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command:config}}\n");

      const result = await generateDoc({
        command: testCommand,
        files: { [filePath]: ["greet"] },
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain(filePath);
      expect(paths).toContain(outputPath);
      // files results come before templates results
      expect(paths.indexOf(filePath)).toBeLessThan(paths.indexOf(outputPath));
    });

    // A trailing colon is ambiguous with the root command placeholder and must be rejected.
    it("{{politty:command:}} (trailing colon) throws with clear message", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "{{politty:command:}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          templates: { [outputPath]: templatePath },
        }),
      ).rejects.toThrow(/trailing colon|use \{\{politty:command\}\}/);
    });

    // The explicit typed-root form uses an empty scope plus a section type.
    it("{{politty:command::usage}} (typed root) renders root usage section without error", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      fs.writeFileSync(templatePath, "# Usage\n\n{{politty:command::usage}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("test-cli");
      expect(content).not.toContain("<!-- politty:");
      expect(content).not.toContain("{{politty:");
    });

    // Template-only commands must still participate in global option compatibility checks.
    it("template-only command with incompatible global option throws compatibility error", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      const rootDocPath = path.join(testDir, "root.md");

      // greet command has a "name" option (positional), so use a fresh command that has
      // a "verbose" option on a subcommand with a DIFFERENT type than the global definition.
      const conflictCommand = defineCommand({
        name: "conflict-cli",
        description: "CLI for testing template-only global option conflict",
        subCommands: {
          run: defineCommand({
            name: "run",
            description: "Run something",
            args: z.object({
              // verbose here is z.string() but globalOptions defines it as z.boolean() — incompatible
              verbose: arg(z.string(), {
                description: "Verbosity level (string, conflicts with global boolean)",
              }),
            }),
            run: () => {},
          }),
        },
      });

      // "run" is referenced only via the template, not through files.
      fs.writeFileSync(templatePath, "{{politty:command:run}}\n");

      await expect(
        generateDoc({
          command: conflictCommand,
          // No files entry for "run" — it is a template-only reference
          templates: { [outputPath]: templatePath },
          rootDoc: {
            path: rootDocPath,
            globalOptions: {
              verbose: arg(z.boolean().default(false), {
                alias: "v",
                description: "Enable verbose output",
              }),
            },
          },
        }),
      ).rejects.toThrow('does not match globalOptions definition for "verbose"');
    });

    // Template sources must never overlap with generated outputs.
    it("template source path conflicting with a files key throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const sharedPath = path.join(testDir, "cli.md");
      const outputPath = path.join(testDir, "readme.md");
      fs.writeFileSync(sharedPath, "{{politty:command}}\n");

      // sharedPath is both a files key and the template source — must throw
      await expect(
        generateDoc({
          command: testCommand,
          files: { [sharedPath]: [""] },
          templates: { [outputPath]: sharedPath },
        }),
      ).rejects.toThrow(/Template source path.*conflicts with a files output key/);
    });

    it("template source path conflicting with another template output path throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templateA = path.join(testDir, "template-a.md");
      const outputA = path.join(testDir, "output-a.md");
      const outputB = path.join(testDir, "output-b.md");
      fs.writeFileSync(templateA, "{{politty:command}}\n");

      // outputA is both a template output and the source for templateB — must throw
      await expect(
        generateDoc({
          command: testCommand,
          templates: {
            [outputA]: templateA,
            [outputB]: outputA,
          },
        }),
      ).rejects.toThrow(/Template source path.*conflicts with a template output path/);
    });

    it("template source path conflicting with rootDoc.path throws", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const rootDocPath = path.join(testDir, "root.md");
      const outputPath = path.join(testDir, "readme.md");
      // rootDocPath is used as the template source — must throw
      fs.writeFileSync(rootDocPath, "{{politty:command}}\n");

      await expect(
        generateDoc({
          command: testCommand,
          rootDoc: { path: rootDocPath },
          templates: { [outputPath]: rootDocPath },
        }),
      ).rejects.toThrow(/Template source path.*conflicts with rootDoc\.path/);
    });

    // globalArgs-derived options should not duplicate command options in templates-only mode.
    it("templates-only with globalArgs: global option appears once and not in command options", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "template.md");
      const outputPath = path.join(testDir, "output.md");
      // Use root command scope ({{politty:command}}) — testCommand root has "verbose" in its
      // own args; "--verbose" must not appear in both the global-options table and the
      // root command's own options table.
      fs.writeFileSync(templatePath, "{{politty:global-options}}\n\n{{politty:command}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
        globalArgs: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose output",
          }),
        }),
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      // The global-options section must be present
      expect(content).toContain("global-options");
      // Count table rows containing "--verbose": the option name in a markdown table cell.
      // "--verbose" should appear in exactly one table row (the global-options table).
      const verboseOptionRows = content.split("\n").filter((line) => line.includes("--verbose"));
      expect(verboseOptionRows).toHaveLength(1);
    });

    // globalArgs-derived stripping/linking must NOT leak into files outputs, which have no
    // reachable #global-options anchor. Only templates-only mode derives from globalArgs.
    it("globalArgs does not strip options or add dead global-options link in files outputs", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const filesOutputPath = path.join(testDir, "cmd.md");
      const templatePath = path.join(testDir, "readme-template.md");
      const templateOutputPath = path.join(testDir, "readme.md");
      // Template does not need a global-options placeholder for this test.
      fs.writeFileSync(templatePath, "{{politty:command:greet}}\n");

      const result = await generateDoc({
        command: testCommand,
        files: { [filesOutputPath]: [""] },
        templates: { [templateOutputPath]: templatePath },
        globalArgs: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose output",
          }),
        }),
      });
      expect(result.success).toBe(true);
      const filesContent = fs.readFileSync(filesOutputPath, "utf-8");
      // The root command's own --verbose option must remain (not stripped).
      expect(filesContent).toContain("--verbose");
      // No dead link to a #global-options anchor that the files output never emits.
      expect(filesContent).not.toContain("#global-options");
    });

    // Template-derived index lists only the scopes actually rendered as headings,
    // each exactly once, never expanding a parent to unrendered sibling subcommands.
    it("index placeholder lists only explicitly rendered scopes, once each", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const indexTemplatePath = path.join(testDir, "index-template.md");
      const indexOutputPath = path.join(testDir, "index.md");
      const commandTemplatePath = path.join(testDir, "cmd-template.md");
      const commandOutputPath = path.join(testDir, "cmd.md");

      // Template A: renders the index
      fs.writeFileSync(indexTemplatePath, "{{politty:index}}\n");
      // Template B: references both the root ("") and the "config get" subcommand explicitly.
      // The root has other subcommands (greet, config set) that are NOT referenced.
      fs.writeFileSync(
        commandTemplatePath,
        "{{politty:command}}\n\n{{politty:command:config get}}\n",
      );

      const result = await generateDoc({
        command: testCommand,
        templates: {
          [indexOutputPath]: indexTemplatePath,
          [commandOutputPath]: commandTemplatePath,
        },
      });
      expect(result.success).toBe(true);
      const indexContent = fs.readFileSync(indexOutputPath, "utf-8");

      // "config get" (explicitly rendered) appears exactly once.
      expect(indexContent.match(/config get/g)?.length ?? 0).toBe(1);
      // Unrendered sibling subcommands must not appear in the index.
      expect(indexContent).not.toContain("config set");
      expect(indexContent).not.toContain("greet");
    });

    // A parent-only template must not emit local anchor links to children that have
    // no heading in the output (template mode does not auto-expand subcommands).
    it("parent-only template renders unrendered children without broken anchor links", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "root-only-template.md");
      const outputPath = path.join(testDir, "root-only.md");

      // Only the root is rendered; its children (greet, config) get no heading here.
      fs.writeFileSync(templatePath, "{{politty:command}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");

      // The subcommands table lists the children as plain text, not as dead local links.
      expect(content).toContain("greet");
      expect(content).not.toContain("(#greet)");
      expect(content).not.toContain("(#config)");
    });

    // An explicitly rendered child still links correctly within the same output.
    it("explicitly rendered child keeps its local anchor link", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "root-and-greet-template.md");
      const outputPath = path.join(testDir, "root-and-greet.md");

      // Both root and the greet subcommand are rendered in the same output.
      fs.writeFileSync(templatePath, "{{politty:command}}\n\n{{politty:command:greet}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");

      // greet is rendered, so its row in the subcommands table links to the local anchor.
      expect(content).toContain("(#greet)");
    });

    // Per-output global options: a template WITHOUT {{politty:global-options}} must not strip
    // options or add a dead #global-options link, even when another template (or globalArgs)
    // provides global options.
    it("global options apply only to outputs that emit the global-options anchor", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const withGoTemplate = path.join(testDir, "with-go-template.md");
      const withGoOutput = path.join(testDir, "with-go.md");
      const noGoTemplate = path.join(testDir, "no-go-template.md");
      const noGoOutput = path.join(testDir, "no-go.md");

      // Template A emits the global-options anchor and a command section.
      fs.writeFileSync(withGoTemplate, "{{politty:global-options}}\n\n{{politty:command}}\n");
      // Template B renders the same root command but does NOT emit a global-options anchor.
      fs.writeFileSync(noGoTemplate, "{{politty:command}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: {
          [withGoOutput]: withGoTemplate,
          [noGoOutput]: noGoTemplate,
        },
        globalArgs: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose output",
          }),
        }),
      });
      expect(result.success).toBe(true);

      // Output WITH the anchor: verbose appears once (in the global-options table only).
      const withGo = fs.readFileSync(withGoOutput, "utf-8");
      expect(withGo.split("\n").filter((l) => l.includes("--verbose"))).toHaveLength(1);

      // Output WITHOUT the anchor: verbose stays in the command's own options table and there is
      // no dead #global-options link.
      const noGo = fs.readFileSync(noGoOutput, "utf-8");
      expect(noGo).toContain("--verbose");
      expect(noGo).not.toContain("#global-options");
    });

    // Typed-only placeholders do not produce a heading, so they must not appear in another
    // template's index (which would link to a nonexistent anchor).
    it("index does not list scopes referenced only by typed placeholders", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const indexTemplate = path.join(testDir, "idx-template.md");
      const indexOutput = path.join(testDir, "idx.md");
      const typedTemplate = path.join(testDir, "typed-template.md");
      const typedOutput = path.join(testDir, "typed.md");

      fs.writeFileSync(indexTemplate, "{{politty:index}}\n");
      // Only a typed section of greet — no greet heading is rendered here.
      fs.writeFileSync(typedTemplate, "{{politty:command:greet:usage}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: {
          [indexOutput]: indexTemplate,
          [typedOutput]: typedTemplate,
        },
      });
      expect(result.success).toBe(true);

      // greet has no heading anywhere, so it must not be listed in the index.
      const idx = fs.readFileSync(indexOutput, "utf-8");
      expect(idx).not.toContain("greet");
    });

    // The explicit "heading" section DOES produce an anchor, so such scopes are indexable.
    it("index lists scopes rendered via an explicit heading placeholder", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const indexTemplate = path.join(testDir, "idx2-template.md");
      const indexOutput = path.join(testDir, "idx2.md");
      const headingTemplate = path.join(testDir, "heading-template.md");
      const headingOutput = path.join(testDir, "heading.md");

      fs.writeFileSync(indexTemplate, "{{politty:index}}\n");
      // Render greet via its heading section — this emits a #greet anchor.
      fs.writeFileSync(headingTemplate, "{{politty:command:greet:heading}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: {
          [indexOutput]: indexTemplate,
          [headingOutput]: headingTemplate,
        },
      });
      expect(result.success).toBe(true);

      const idx = fs.readFileSync(indexOutput, "utf-8");
      expect(idx).toContain("greet");
    });

    // Handwritten blank lines (e.g. inside a fenced code block) must be preserved verbatim;
    // template content is the source of truth and is not reflowed.
    it("preserves handwritten blank lines around generated content", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "blanks-template.md");
      const outputPath = path.join(testDir, "blanks.md");

      // A fenced code block with an intentional internal blank line, then a placeholder.
      const template = "```\nline1\n\n\nline2\n```\n\n{{politty:command:greet:heading}}\n";
      fs.writeFileSync(templatePath, template);

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      // The three consecutive newlines inside the code block survive untouched.
      expect(content).toContain("line1\n\n\nline2");
    });

    // An empty own-line placeholder between two single newlines must not concatenate the
    // adjacent handwritten lines.
    it("empty own-line placeholder keeps adjacent lines separated", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "tight-template.md");
      const outputPath = path.join(testDir, "tight.md");
      // greet has no examples, so the typed placeholder resolves to empty.
      fs.writeFileSync(templatePath, "Before\n{{politty:command:greet:examples}}\nAfter\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).not.toContain("BeforeAfter");
      expect(content).toContain("Before");
      expect(content).toContain("After");
    });

    it("empty inline placeholder at line end keeps the following newline", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "inline-empty-template.md");
      const outputPath = path.join(testDir, "inline-empty.md");
      fs.writeFileSync(templatePath, "Before{{politty:command:greet:examples}}\nAfter\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toBe("Before\nAfter\n");
    });

    it("empty own-line placeholder at file start does not leave a leading blank line", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "leading-empty-template.md");
      const outputPath = path.join(testDir, "leading-empty.md");
      fs.writeFileSync(templatePath, "{{politty:command:greet:examples}}\nAfter\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toBe("After\n");
    });

    // A typed-only ancestor placeholder must not skew the heading depth of the full-section
    // command. Here "config" is referenced only via a typed (options) placeholder, so the
    // heading depth is computed from "config get" alone — identical to rendering it on its own.
    it("typed-only ancestor does not skew heading depth of a full-section command", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const withAncestor = path.join(testDir, "with-ancestor-template.md");
      const withAncestorOut = path.join(testDir, "with-ancestor.md");
      const aloneTemplate = path.join(testDir, "alone-template.md");
      const aloneOut = path.join(testDir, "alone.md");

      // One template references config (typed-only) plus config get (full section).
      fs.writeFileSync(
        withAncestor,
        "{{politty:command:config:options}}\n\n{{politty:command:config get}}\n",
      );
      // The other renders config get alone.
      fs.writeFileSync(aloneTemplate, "{{politty:command:config get}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: {
          [withAncestorOut]: withAncestor,
          [aloneOut]: aloneTemplate,
        },
      });
      expect(result.success).toBe(true);

      // The "config get" heading must render at the same level in both outputs (its depth is not
      // pulled shallower by the typed-only "config" reference).
      const withAncestorContent = fs.readFileSync(withAncestorOut, "utf-8");
      const aloneContent = fs.readFileSync(aloneOut, "utf-8");
      const headingOf = (c: string): string =>
        c.split("\n").find((l) => /^#+\s+(config get|get)\b/.test(l)) ?? "";
      expect(headingOf(withAncestorContent)).toBe(headingOf(aloneContent));
      expect(headingOf(aloneContent)).not.toBe("");
    });

    // A template that does NOT emit the global-options anchor must not be subjected to
    // globalArgs compatibility validation (its options are left intact).
    it("globalArgs compatibility is not enforced on non-emitting templates", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const conflictCommand = defineCommand({
        name: "conflict-cli",
        description: "CLI whose subcommand has a local option clashing with a global name",
        subCommands: {
          run: defineCommand({
            name: "run",
            description: "Run",
            // Local "verbose" is a string, differing from the global boolean definition.
            args: z.object({
              verbose: arg(z.string().optional(), { description: "Verbosity label" }),
            }),
            run: () => {},
          }),
        },
      });
      const templatePath = path.join(testDir, "conflict-template.md");
      const outputPath = path.join(testDir, "conflict.md");
      // No {{politty:global-options}} here, so the local verbose must not be validated.
      fs.writeFileSync(templatePath, "{{politty:command:run}}\n");

      const result = await generateDoc({
        command: conflictCommand,
        templates: { [outputPath]: templatePath },
        globalArgs: z.object({
          verbose: arg(z.boolean().default(false), { description: "Enable verbose output" }),
        }),
      });
      // Must NOT throw a compatibility error; the command renders with its own verbose option.
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("--verbose");
    });

    // For a union/discriminated-union command, an excluded global option must not reappear in the
    // grouped option table rendered from `extracted`.
    it("excluded global option is removed from grouped (union) option tables", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const unionCommand = defineCommand({
        name: "union-cli",
        description: "CLI with a discriminated-union schema and a shared global option",
        args: z.discriminatedUnion("action", [
          z.object({
            action: z.literal("create"),
            name: arg(z.string(), { description: "Resource name" }),
            verbose: arg(z.boolean().default(false), { description: "Enable verbose output" }),
          }),
          z.object({
            action: z.literal("delete"),
            id: arg(z.string(), { description: "Resource id" }),
            verbose: arg(z.boolean().default(false), { description: "Enable verbose output" }),
          }),
        ]),
        run: () => {},
      });
      const templatePath = path.join(testDir, "union-template.md");
      const outputPath = path.join(testDir, "union.md");
      fs.writeFileSync(templatePath, "{{politty:global-options}}\n\n{{politty:command}}\n");

      const result = await generateDoc({
        command: unionCommand,
        templates: { [outputPath]: templatePath },
        globalArgs: z.object({
          verbose: arg(z.boolean().default(false), { description: "Enable verbose output" }),
        }),
      });
      expect(result.success).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      // verbose appears once — in the global-options table — not again in the union option groups.
      expect(content.split("\n").filter((l) => l.includes("--verbose"))).toHaveLength(1);
    });

    it("rootDoc global option is removed from grouped option tables in templates", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const unionCommand = defineCommand({
        name: "union-cli",
        description: "CLI with rootDoc global options and a grouped local schema",
        args: z.discriminatedUnion("action", [
          z.object({
            action: z.literal("create"),
            name: arg(z.string(), { description: "Resource name" }),
            verbose: arg(z.boolean().default(false), { description: "Enable verbose output" }),
          }),
          z.object({
            action: z.literal("delete"),
            id: arg(z.string(), { description: "Resource id" }),
            verbose: arg(z.boolean().default(false), { description: "Enable verbose output" }),
          }),
        ]),
        run: () => {},
      });
      const rootDocPath = path.join(testDir, "union-root.md");
      const templatePath = path.join(testDir, "union-root-template.md");
      const outputPath = path.join(testDir, "union-output.md");
      const globalOptions = {
        verbose: arg(z.boolean().default(false), { description: "Enable verbose output" }),
      };
      fs.writeFileSync(
        rootDocPath,
        [
          "# union-cli",
          "",
          "CLI with rootDoc global options and a grouped local schema",
          "",
          "<!-- politty:global-options:start -->",
          renderArgsTable(globalOptions),
          "<!-- politty:global-options:end -->",
          "",
        ].join("\n"),
      );
      fs.writeFileSync(templatePath, "{{politty:command}}\n");

      const result = await generateDoc({
        command: unionCommand,
        templates: { [outputPath]: templatePath },
        rootDoc: {
          path: rootDocPath,
          globalOptions,
        },
      });
      expect(result.success).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).not.toContain("--verbose");
    });

    // initDocFile must never delete a path that is also used as a template source, so a
    // misconfigured { [p]: p } entry surfaces as a generateDoc validation error, not data loss.
    it("initDocFile does not delete a path also used as a template source", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const shared = path.join(testDir, "shared.md");
      fs.writeFileSync(shared, "{{politty:command}}\n");

      initDocFile({ templates: { [shared]: shared } });

      // The source file must still exist (not deleted as if it were a disposable output).
      expect(fs.existsSync(shared)).toBe(true);
    });

    // Cross-output links between templates: a parent rendered in one template links its
    // subcommand to the other template output where that subcommand's heading is rendered.
    it("subcommands table links to a heading rendered in another template output", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const parentTemplate = path.join(testDir, "parent-template.md");
      const parentOutput = path.join(testDir, "parent.md");
      const childTemplate = path.join(testDir, "child-template.md");
      const childOutput = path.join(testDir, "child.md");

      // The parent (config) is rendered in one output; its child (config get) only in the other.
      fs.writeFileSync(parentTemplate, "{{politty:command:config}}\n");
      fs.writeFileSync(childTemplate, "{{politty:command:config get}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: {
          [parentOutput]: parentTemplate,
          [childOutput]: childTemplate,
        },
      });
      expect(result.success).toBe(true);

      // config's subcommands table links "config get" to the child output, not a dead local anchor.
      const parentContent = fs.readFileSync(parentOutput, "utf-8");
      expect(parentContent).toContain("child.md#config-get");
    });

    // A command whose name contains a colon must be referenceable from a template, matching
    // files mode (the section type is only consumed when the last token is a known type).
    it("supports colon-containing command names in template placeholders", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const colonCommand = defineCommand({
        name: "db-cli",
        description: "DB CLI",
        subCommands: {
          "db:migrate": defineCommand({
            name: "db:migrate",
            description: "Run migrations",
            run: () => {},
          }),
        },
      });
      const templatePath = path.join(testDir, "colon-template.md");
      const outputPath = path.join(testDir, "colon.md");
      // Full section and a typed section of the colon-named command.
      fs.writeFileSync(
        templatePath,
        "{{politty:command:db:migrate}}\n\n{{politty:command:db:migrate:usage}}\n",
      );

      const result = await generateDoc({
        command: colonCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("db:migrate");
    });

    it("prefers full colon-containing command scope over trailing section type", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const colonCommand = defineCommand({
        name: "db-cli",
        description: "DB CLI",
        subCommands: {
          "db:usage": defineCommand({
            name: "db:usage",
            description: "Command whose name ends with a section type",
            run: () => {},
          }),
        },
      });
      const templatePath = path.join(testDir, "colon-usage-template.md");
      const outputPath = path.join(testDir, "colon-usage.md");
      fs.writeFileSync(templatePath, "{{politty:command:db:usage}}\n");

      const result = await generateDoc({
        command: colonCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("# db:usage");
      expect(content).toContain("Command whose name ends with a section type");
    });

    // Handwritten blank-line runs unrelated to placeholders must survive (no global reflow).
    it("does not collapse handwritten blank-line runs outside placeholders", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const templatePath = path.join(testDir, "prose-template.md");
      const outputPath = path.join(testDir, "prose.md");
      // Three blank lines between two prose paragraphs, far from any placeholder.
      fs.writeFileSync(templatePath, "Para one.\n\n\n\nPara two.\n\n{{politty:command:greet}}\n");

      const result = await generateDoc({
        command: testCommand,
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);
      const content = fs.readFileSync(outputPath, "utf-8");
      expect(content).toContain("Para one.\n\n\n\nPara two.");
    });

    // A self-contained template that emits {{politty:global-options}} must link its subcommand
    // sections to its OWN #global-options anchor, even when rootDoc.globalOptions also exists.
    it("self-contained template links global options locally, not to rootDoc", async () => {
      vi.stubEnv(UPDATE_GOLDEN_ENV, "true");
      const rootDocPath = path.join(testDir, "root.md");
      // rootDoc must exist with its markers for generateDoc to validate it.
      fs.writeFileSync(
        rootDocPath,
        [
          "# test-cli",
          "",
          "A test CLI for documentation generation",
          "",
          "<!-- politty:global-options:start -->",
          '<a id="global-options"></a>',
          "",
          "| Option | Alias | Description | Required | Default |",
          "| --- | --- | --- | --- | --- |",
          "| `--verbose` | `-v` | Enable verbose output | No | `false` |",
          "<!-- politty:global-options:end -->",
          "",
        ].join("\n"),
      );
      const templatePath = path.join(testDir, "tmpl-template.md");
      const outputPath = path.join(testDir, "tmpl.md");
      // Render a subcommand (which gets a global-options link) plus the local global-options table.
      fs.writeFileSync(
        templatePath,
        "{{politty:global-options}}\n\n{{politty:command:config get}}\n",
      );

      const result = await generateDoc({
        command: testCommand,
        rootDoc: {
          path: rootDocPath,
          globalOptions: { verbose: arg(z.boolean().default(false), { alias: "v" }) },
        },
        templates: { [outputPath]: templatePath },
      });
      expect(result.success).toBe(true);

      const content = fs.readFileSync(outputPath, "utf-8");
      // The global-options link in command sections must point at the local anchor, not root.md.
      expect(content).toContain("#global-options");
      expect(content).not.toContain("root.md#global-options");
    });
  });
});
