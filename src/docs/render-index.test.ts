import { describe, expect, it } from "vitest";
import { defineCommand } from "../index.js";
import { renderCommandIndex, type CommandCategory } from "./render-index.js";

describe("renderCommandIndex", () => {
  it("should render command index with categories", async () => {
    const initCmd = defineCommand({
      name: "init",
      description: "Initialize a project",
      run: () => {},
    });

    const generateCmd = defineCommand({
      name: "generate",
      description: "Generate files",
      run: () => {},
    });

    const loginCmd = defineCommand({
      name: "login",
      description: "Login to the service",
      run: () => {},
    });

    const mainCmd = defineCommand({
      name: "cli",
      description: "CLI tool",
      subCommands: {
        init: initCmd,
        generate: generateCmd,
        login: loginCmd,
      },
    });

    const categories: CommandCategory[] = [
      {
        title: "Application Commands",
        description: "Commands for managing applications.",
        commands: ["init", "generate"],
        docPath: "./cli/application.md",
      },
      {
        title: "Auth Commands",
        description: "Commands for authentication.",
        commands: ["login"],
        docPath: "./cli/auth.md",
      },
    ];

    const result = await renderCommandIndex(mainCmd, categories);

    // Check first category
    expect(result).toContain("### [Application Commands](./cli/application.md)");
    expect(result).toContain("Commands for managing applications.");
    expect(result).toContain("| [init](./cli/application.md#init) | Initialize a project |");
    expect(result).toContain("| [generate](./cli/application.md#generate) | Generate files |");

    // Check second category
    expect(result).toContain("### [Auth Commands](./cli/auth.md)");
    expect(result).toContain("Commands for authentication.");
    expect(result).toContain("| [login](./cli/auth.md#login) | Login to the service |");
  });

  it("should expand parent commands to leaf commands", async () => {
    const truncateCmd = defineCommand({
      name: "truncate",
      description: "Truncate tables",
      run: () => {},
    });

    const migrateGenerateCmd = defineCommand({
      name: "generate",
      description: "Generate migration",
      run: () => {},
    });

    const migrateCmd = defineCommand({
      name: "migrate",
      description: "Manage migrations",
      subCommands: {
        generate: migrateGenerateCmd,
      },
    });

    const tailordbCmd = defineCommand({
      name: "tailordb",
      description: "TailorDB commands",
      subCommands: {
        truncate: truncateCmd,
        migrate: migrateCmd,
      },
    });

    const mainCmd = defineCommand({
      name: "cli",
      subCommands: {
        tailordb: tailordbCmd,
      },
    });

    const categories: CommandCategory[] = [
      {
        title: "TailorDB Commands",
        description: "Commands for TailorDB.",
        commands: ["tailordb"], // Parent command - should expand to leaf commands
        docPath: "./cli/tailordb.md",
      },
    ];

    const result = await renderCommandIndex(mainCmd, categories);

    // Should include leaf commands
    expect(result).toContain("| [tailordb truncate](./cli/tailordb.md#tailordb-truncate) |");
    expect(result).toContain(
      "| [tailordb migrate generate](./cli/tailordb.md#tailordb-migrate-generate) |",
    );

    // Should NOT include intermediate commands (non-leaf) by default
    expect(result).not.toContain("| [tailordb](");
    expect(result).not.toContain("| [tailordb migrate](./cli/tailordb.md#tailordb-migrate) |");
  });

  it("should include non-leaf commands when leafOnly is false", async () => {
    const subCmd = defineCommand({
      name: "sub",
      description: "Sub command",
      run: () => {},
    });

    const parentCmd = defineCommand({
      name: "parent",
      description: "Parent command",
      subCommands: {
        sub: subCmd,
      },
    });

    const mainCmd = defineCommand({
      name: "cli",
      subCommands: {
        parent: parentCmd,
      },
    });

    const categories: CommandCategory[] = [
      {
        title: "Commands",
        description: "All commands.",
        commands: ["parent"],
        docPath: "./cli/commands.md",
      },
    ];

    const result = await renderCommandIndex(mainCmd, categories, { leafOnly: false });

    // Should include both parent and child commands when leafOnly is false
    expect(result).toContain("| [parent](./cli/commands.md#parent) |");
    expect(result).toContain("| [parent sub](./cli/commands.md#parent-sub) |");
  });

  it("should use custom heading level", async () => {
    const initCmd = defineCommand({
      name: "init",
      description: "Initialize",
      run: () => {},
    });

    const mainCmd = defineCommand({
      name: "cli",
      subCommands: {
        init: initCmd,
      },
    });

    const categories: CommandCategory[] = [
      {
        title: "Commands",
        description: "Commands.",
        commands: ["init"],
        docPath: "./cli/commands.md",
      },
    ];

    const result = await renderCommandIndex(mainCmd, categories, { headingLevel: 2 });

    expect(result).toContain("## [Commands](./cli/commands.md)");
    expect(result).not.toContain("### [Commands]");
  });

  it("should escape special characters in table cells", async () => {
    const pipeCmd = defineCommand({
      name: "pipe",
      description: "Command with | pipe character",
      run: () => {},
    });

    const mainCmd = defineCommand({
      name: "cli",
      subCommands: {
        pipe: pipeCmd,
      },
    });

    const categories: CommandCategory[] = [
      {
        title: "Commands",
        description: "Test commands.",
        commands: ["pipe"],
        docPath: "./cli.md",
      },
    ];

    const result = await renderCommandIndex(mainCmd, categories);

    expect(result).toContain("Command with \\| pipe character");
  });

  it("should handle empty commands array", async () => {
    const mainCmd = defineCommand({
      name: "cli",
      run: () => {},
    });

    const categories: CommandCategory[] = [
      {
        title: "Commands",
        description: "Test commands.",
        commands: [],
        docPath: "./cli.md",
      },
    ];

    const result = await renderCommandIndex(mainCmd, categories);

    expect(result).toContain("### [Commands](./cli.md)");
    expect(result).toContain("Test commands.");
    expect(result).toContain("| Command | Description |");
    // No command rows
  });

  it("should handle missing commands gracefully", async () => {
    const initCmd = defineCommand({
      name: "init",
      description: "Initialize",
      run: () => {},
    });

    const mainCmd = defineCommand({
      name: "cli",
      subCommands: {
        init: initCmd,
      },
    });

    const categories: CommandCategory[] = [
      {
        title: "Commands",
        description: "Test commands.",
        commands: ["init", "nonexistent"], // nonexistent should be skipped
        docPath: "./cli.md",
      },
    ];

    const result = await renderCommandIndex(mainCmd, categories);

    expect(result).toContain("| [init](./cli.md#init) | Initialize |");
    expect(result).not.toContain("nonexistent");
  });
});
