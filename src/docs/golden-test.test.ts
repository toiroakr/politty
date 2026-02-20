import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand } from "../index.js";
import { assertDocMatch, generateDoc } from "./golden-test.js";
import { renderArgsTable } from "./render-args.js";
import { renderCommandIndex } from "./render-index.js";
import { UPDATE_GOLDEN_ENV } from "./types.js";

/** Get relative path from CWD (for index marker scope) */
function relPath(absPath: string): string {
  return path.relative(process.cwd(), absPath);
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

      // Verify section markers are included
      expect(content).toContain("<!-- politty:command::heading:start -->");
      expect(content).toContain("<!-- politty:command::heading:end -->");
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
  });
});
