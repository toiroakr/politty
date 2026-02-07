import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "../index.js";
import { renderArgsTable } from "./render-args.js";

describe("renderArgsTable", () => {
  it("should render args as options table", () => {
    const args = {
      verbose: arg(z.boolean().default(false), {
        alias: "v",
        description: "Enable verbose mode",
      }),
      output: arg(z.string(), {
        alias: "o",
        description: "Output directory",
      }),
    };

    const table = renderArgsTable(args);

    expect(table).toContain("| Option | Alias | Description | Required | Default |");
    expect(table).toContain("| `--verbose` | `-v` | Enable verbose mode | No | `false` |");
    expect(table).toContain("| `--output <OUTPUT>` | `-o` | Output directory | Yes | - |");
  });

  it("should handle args without alias", () => {
    const args = {
      config: arg(z.string(), {
        description: "Config file path",
      }),
    };

    const table = renderArgsTable(args);

    expect(table).toContain("| `--config <CONFIG>` | - | Config file path | Yes | - |");
  });

  it("should convert camelCase to kebab-case", () => {
    const args = {
      dryRun: arg(z.boolean().default(false), {
        description: "Dry run mode",
      }),
      outputDir: arg(z.string(), {
        description: "Output directory",
      }),
    };

    const table = renderArgsTable(args);

    expect(table).toContain("--dry-run");
    expect(table).toContain("--output-dir");
    expect(table).not.toContain("--dryRun");
    expect(table).not.toContain("--outputDir");
  });

  it("should display env column when args have env configured", () => {
    const args = {
      port: arg(z.coerce.number(), {
        env: "PORT",
        description: "Server port",
      }),
      host: arg(z.string().default("localhost"), {
        description: "Server host",
      }),
    };

    const table = renderArgsTable(args);

    expect(table).toContain("| Option | Alias | Description | Required | Default | Env |");
    expect(table).toContain("`PORT`");
  });

  it("should display multiple env vars", () => {
    const args = {
      token: arg(z.string(), {
        env: ["TOKEN", "AUTH_TOKEN"],
        description: "Authentication token",
      }),
    };

    const table = renderArgsTable(args);

    expect(table).toContain("`TOKEN`");
    expect(table).toContain("`AUTH_TOKEN`");
  });

  it("should exclude positional arguments", () => {
    const args = {
      file: arg(z.string(), {
        positional: true,
        description: "File path",
      }),
      verbose: arg(z.boolean().default(false), {
        description: "Verbose mode",
      }),
    };

    const table = renderArgsTable(args);

    // Should include verbose (non-positional)
    expect(table).toContain("--verbose");
    // Should NOT include file (positional)
    expect(table).not.toContain("file");
  });

  it("should return empty string when no non-positional args", () => {
    const args = {
      file: arg(z.string(), {
        positional: true,
        description: "File path",
      }),
    };

    const table = renderArgsTable(args);

    expect(table).toBe("");
  });

  it("should merge multiple args objects", () => {
    const commonArgs = {
      verbose: arg(z.boolean().default(false), {
        alias: "v",
        description: "Verbose mode",
      }),
    };

    const workspaceArgs = {
      "workspace-id": arg(z.string(), {
        alias: "w",
        description: "Workspace ID",
      }),
    };

    const table = renderArgsTable({
      ...commonArgs,
      ...workspaceArgs,
    });

    expect(table).toContain("--verbose");
    expect(table).toContain("--workspace-id");
  });

  describe("with columns option", () => {
    it("should render only specified columns", () => {
      const args = {
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Enable verbose mode",
        }),
      };

      const table = renderArgsTable(args, {
        columns: ["option", "description"],
      });

      expect(table).toContain("| Option | Description |");
      expect(table).toContain("| `--verbose` | Enable verbose mode |");
      expect(table).not.toContain("Alias");
      expect(table).not.toContain("Default");
    });

    it("should render columns in specified order", () => {
      const args = {
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Verbose",
        }),
      };

      const table = renderArgsTable(args, {
        columns: ["description", "option", "alias"],
      });

      const headerLine = table.split("\n")[0];
      expect(headerLine).toBe("| Description | Option | Alias |");
    });
  });
});
