import { describe, expect, it } from "vitest";
import { defineCommand } from "../core/command.js";
import { listSubCommands, resolveSubcommand } from "./subcommand-router.js";

/**
 * Task 7.1: サブコマンドルーターのテスト
 * - サブコマンド名から対応するコマンド定義を解決
 * - 遅延ロード（動的import）でサブコマンドを読み込む
 * - 複数階層のサブコマンドを再帰的に処理
 */
describe("SubcommandRouter", () => {
  describe("resolveSubcommand", () => {
    it("should resolve sync subcommand", async () => {
      const buildCmd = defineCommand({
        name: "build",
        description: "Build the project",
      });

      const cmd = defineCommand({
        name: "cli",
        subCommands: { build: buildCmd },
      });

      const result = await resolveSubcommand(cmd, "build");

      expect(result).toBe(buildCmd);
    });

    it("should resolve async (lazy-loaded) subcommand", async () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          lazy: async () =>
            defineCommand({
              name: "lazy",
              description: "Lazy loaded command",
            }),
        },
      });

      const result = await resolveSubcommand(cmd, "lazy");

      expect(result?.name).toBe("lazy");
      expect(result?.description).toBe("Lazy loaded command");
    });

    it("should return undefined for unknown subcommand", async () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
        },
      });

      const result = await resolveSubcommand(cmd, "unknown");

      expect(result).toBeUndefined();
    });

    it("should return undefined when no subcommands defined", async () => {
      const cmd = defineCommand({ name: "cli" });

      const result = await resolveSubcommand(cmd, "anything");

      expect(result).toBeUndefined();
    });
  });

  describe("listSubCommands", () => {
    it("should list all subcommand names", () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          build: defineCommand({ name: "build" }),
          test: defineCommand({ name: "test" }),
          deploy: defineCommand({ name: "deploy" }),
        },
      });

      const result = listSubCommands(cmd);

      expect(result).toEqual(["build", "test", "deploy"]);
    });

    it("should include lazy-loaded subcommands", () => {
      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          sync: defineCommand({ name: "sync" }),
          async: async () => defineCommand({ name: "async" }),
        },
      });

      const result = listSubCommands(cmd);

      expect(result).toContain("sync");
      expect(result).toContain("async");
    });

    it("should return empty array when no subcommands", () => {
      const cmd = defineCommand({ name: "cli" });

      const result = listSubCommands(cmd);

      expect(result).toEqual([]);
    });
  });
});
