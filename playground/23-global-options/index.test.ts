import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { assertDocMatch, initDocFile } from "../../src/docs/index.js";
import { runCommand } from "../../src/index.js";
import { spyOnConsoleLog, type ConsoleSpy } from "../../tests/utils/console.js";
import { mdFormatter } from "../../tests/utils/formatter.js";
import { buildCommand, cli, deployCommand, globalArgsSchema } from "./index.js";

describe("23-global-options", () => {
  let console: ConsoleSpy;

  beforeEach(() => {
    console = spyOnConsoleLog();
  });

  afterEach(() => {
    console.mockRestore();
  });

  describe("build subcommand with global options", () => {
    it("passes global verbose option to subcommand", async () => {
      const result = await runCommand(cli, ["--verbose", "build"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Building project:");
      expect(console).toHaveBeenCalledWith("  [verbose] Verbose mode enabled");
    });

    it("passes global config option to subcommand", async () => {
      const result = await runCommand(cli, ["--config", "./config.json", "build"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  [verbose] Using config: ./config.json");
    });

    it("combines global options with command options", async () => {
      const result = await runCommand(cli, ["-v", "build", "-o", "out", "-m"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Output: out");
      expect(console).toHaveBeenCalledWith("  Minify: true");
      expect(console).toHaveBeenCalledWith("  [verbose] Verbose mode enabled");
    });
  });

  describe("deploy subcommand with global options", () => {
    it("passes global options to deploy subcommand", async () => {
      const result = await runCommand(cli, ["--verbose", "deploy", "--target", "prod"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("Deploying project:");
      expect(console).toHaveBeenCalledWith("  Target: prod");
      expect(console).toHaveBeenCalledWith("  [verbose] Verbose mode enabled");
    });

    it("works with dry-run option", async () => {
      const result = await runCommand(
        cli,
        ["-v", "-c", "prod.json", "deploy", "-t", "staging", "-n"],
        { globalArgs: globalArgsSchema },
      );

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Target: staging");
      expect(console).toHaveBeenCalledWith("  Dry run: true");
      expect(console).toHaveBeenCalledWith("  [verbose] Verbose mode enabled");
      expect(console).toHaveBeenCalledWith("  [verbose] Using config: prod.json");
    });
  });

  describe("help displays Global Options section", () => {
    it("shows Global Options in main CLI help", async () => {
      const result = await runCommand(cli, ["--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("Global Options:");
      expect(output).toContain("--verbose");
      expect(output).toContain("-v");
      expect(output).toContain("Enable verbose output");
      expect(output).toContain("--config");
      expect(output).toContain("-c");
    });

    it("shows Global Options in subcommand help", async () => {
      const result = await runCommand(cli, ["build", "--help"], {
        globalArgs: globalArgsSchema,
      });

      expect(result.exitCode).toBe(0);
      const output = console.getLogs().join("\n");
      expect(output).toContain("Global Options:");
      expect(output).toContain("--verbose");
      expect(output).toContain("--output");
    });
  });

  describe("running subcommand directly", () => {
    it("works with buildCommand directly (no global options)", async () => {
      const result = await runCommand(buildCommand, ["-o", "build", "-m"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Output: build");
      expect(console).toHaveBeenCalledWith("  Minify: true");
    });

    it("works with deployCommand directly (no global options)", async () => {
      const result = await runCommand(deployCommand, ["-t", "prod"]);

      expect(result.exitCode).toBe(0);
      expect(console).toHaveBeenCalledWith("  Target: prod");
    });
  });

  describe("documentation generation", () => {
    const docFile = "playground/23-global-options/docs/CLI.md";

    beforeAll(() => {
      initDocFile(docFile);
    });

    it("generates documentation with global options and root info", async () => {
      await assertDocMatch({
        command: cli,
        files: {
          [docFile]: [""],
        },
        globalArgs: globalArgsSchema,
        rootInfo: {
          title: "My CLI",
          version: "1.0.0",
          description: "A CLI with global options example.",
          installation: "```bash\nnpm install -g my-cli\n```",
          headerContent: "> **Note**: This CLI requires Node.js 18 or higher.",
          footerContent: "## License\n\nMIT License",
        },
        formatter: mdFormatter,
      });
    });

    it("generates subcommand documentation with global options link", async () => {
      await assertDocMatch({
        command: cli,
        files: {
          [docFile]: [""],
        },
        globalArgs: globalArgsSchema,
        rootInfo: {
          title: "My CLI",
          version: "1.0.0",
        },
        targetCommands: ["build"],
        formatter: mdFormatter,
      });
    });
  });

  describe("documentation generation (split files)", () => {
    const rootFile = "playground/23-global-options/docs/split/README.md";
    const buildFile = "playground/23-global-options/docs/split/build.md";

    beforeAll(() => {
      initDocFile({ files: { [rootFile]: [""], [buildFile]: ["build"] } });
    });

    it("generates cross-file link for global options", async () => {
      await assertDocMatch({
        command: cli,
        files: {
          [rootFile]: [""],
          [buildFile]: ["build"],
        },
        globalArgs: globalArgsSchema,
        rootInfo: {
          title: "My CLI",
          version: "1.0.0",
        },
        formatter: mdFormatter,
      });
    });
  });
});
