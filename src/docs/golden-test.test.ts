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
