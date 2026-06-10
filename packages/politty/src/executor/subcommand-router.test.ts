import { describe, expect, it } from "vitest";
import { defineCommand } from "../core/command.js";
import { lazy } from "../lazy.js";
import { listSubCommands, resolveLazyCommand, resolveSubcommand } from "./subcommand-router.js";

/**
 * Task 7.1: Subcommand router tests
 * - Resolve command definition from subcommand name
 * - Load subcommands with lazy loading (dynamic import)
 * - Process nested subcommands recursively
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

    it("should resolve LazyCommand subcommand via load()", async () => {
      const fullCommand = defineCommand({
        name: "deploy",
        description: "Deploy the application",
        run: () => "deployed",
      });

      const cmd = defineCommand({
        name: "cli",
        subCommands: {
          deploy: lazy(
            defineCommand({
              name: "deploy",
              description: "Deploy the application",
            }),
            async () => fullCommand,
          ),
        },
      });

      const result = await resolveSubcommand(cmd, "deploy");

      expect(result).toBe(fullCommand);
      expect(result?.name).toBe("deploy");
    });
  });

  describe("resolveLazyCommand", () => {
    it("should resolve LazyCommand via load()", async () => {
      const fullCommand = defineCommand({ name: "test", run: () => {} });
      const cmd = lazy(defineCommand({ name: "test" }), async () => fullCommand);

      const result = await resolveLazyCommand(cmd);

      expect(result).toBe(fullCommand);
    });

    it("should resolve async function", async () => {
      const fullCommand = defineCommand({ name: "test" });
      const fn = async () => fullCommand;

      const result = await resolveLazyCommand(fn);

      expect(result).toBe(fullCommand);
    });

    it("should return sync command as-is", async () => {
      const cmd = defineCommand({ name: "test" });

      const result = await resolveLazyCommand(cmd);

      expect(result).toBe(cmd);
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
