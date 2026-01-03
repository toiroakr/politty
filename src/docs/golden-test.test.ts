import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand } from "../index.js";
import { assertDocMatch, generateDoc } from "./golden-test.js";
import { UPDATE_GOLDEN_ENV } from "./types.js";

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
      expect(content).toContain("# get");
      expect(content).toContain("# set");
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
      expect(configContent).toContain("# get");
      expect(configContent).toContain("# set");
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
      expect(content).not.toContain("# get");
      expect(content).not.toContain("# set");
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
      expect(content).toContain("# get");
      // Only "config set" should be excluded
      expect(content).not.toContain("# set");
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

      const oxfmtFormatter = (content: string) => {
        return execSync("pnpm oxfmt --stdin-filepath=file.md", {
          input: content,
          encoding: "utf-8",
        });
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
      expect(content).not.toContain("# get");
      expect(content).not.toContain("# set");
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
      expect(content).not.toContain("# get");
      expect(content).not.toContain("# set");
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
      expect(content).not.toContain("# get");
      expect(content).not.toContain("# set");
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
      expect(content).not.toContain("# get");
      expect(content).not.toContain("# set");
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
      expect(content).toContain("# get");
      expect(content).toContain("# set");
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
      expect(content).toContain("# one");
      // "two" subcommands should be excluded
      expect(content).not.toContain("# two");
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
      expect(content).not.toContain("# get");
      expect(content).not.toContain("# set");
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
      expect(content).toContain("# get");
      expect(content).not.toContain("# set");
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
  });
});
