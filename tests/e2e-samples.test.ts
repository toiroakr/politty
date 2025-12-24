import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { z } from "zod";
import { defineCommand, runMain, arg } from "../src/index.js";

/**
 * E2E tests with concrete sample CLI commands
 */
describe("E2E Sample Commands", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let logs: string[];
  let errors: string[];

  beforeEach(() => {
    logs = [];
    errors = [];
    consoleSpy = vi.spyOn(console, "log").mockImplementation((msg) => {
      logs.push(String(msg));
    });
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation((msg) => {
      errors.push(String(msg));
    });
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe("git-like CLI", () => {
    const createGitCli = () => {
      const state = {
        initialized: false,
        commits: [] as string[],
        staged: [] as string[],
      };

      const initCmd = defineCommand({
        name: "init",
        description: "Initialize a new repository",
        args: z.object({
          bare: arg(z.boolean().default(false), {
            description: "Create a bare repository",
          }),
        }),
        run: ({ args }) => {
          state.initialized = true;
          console.log(`Initialized ${args.bare ? "bare " : ""}repository`);
          return { initialized: true, bare: args.bare };
        },
      });

      const addCmd = defineCommand({
        name: "add",
        description: "Add files to staging",
        args: z.object({
          files: arg(z.string(), { positional: true, description: "Files to add" }),
          all: arg(z.boolean().default(false), { alias: "A", description: "Add all files" }),
        }),
        run: ({ args }) => {
          if (args.all) {
            state.staged.push("*");
            console.log("Added all files");
          } else {
            state.staged.push(args.files);
            console.log(`Added ${args.files}`);
          }
        },
      });

      const commitCmd = defineCommand({
        name: "commit",
        description: "Commit staged changes",
        args: z.object({
          message: arg(z.string(), { alias: "m", description: "Commit message" }),
          amend: arg(z.boolean().default(false), { description: "Amend previous commit" }),
        }),
        run: ({ args }) => {
          if (args.amend && state.commits.length > 0) {
            state.commits[state.commits.length - 1] = args.message;
            console.log(`Amended: ${args.message}`);
          } else {
            state.commits.push(args.message);
            console.log(`Committed: ${args.message}`);
          }
          state.staged = [];
          return { hash: `abc${state.commits.length}` };
        },
      });

      const logCmd = defineCommand({
        name: "log",
        description: "Show commit history",
        args: z.object({
          count: arg(z.coerce.number().default(10), {
            alias: "n",
            description: "Number of commits to show",
          }),
          oneline: arg(z.boolean().default(false), {
            description: "Show one line per commit",
          }),
        }),
        run: ({ args }) => {
          const commits = state.commits.slice(-args.count).reverse();
          for (const commit of commits) {
            if (args.oneline) {
              console.log(commit);
            } else {
              console.log(`commit: ${commit}\n`);
            }
          }
          return { commits };
        },
      });

      return {
        cli: defineCommand({
          name: "git",
          version: "1.0.0",
          description: "A simple git-like CLI",
          subCommands: {
            init: initCmd,
            add: addCmd,
            commit: commitCmd,
            log: logCmd,
          },
        }),
        state,
      };
    };

    it("should initialize repository", async () => {
      const { cli } = createGitCli();
      const result = await runMain(cli, { argv: ["init"] });

      expect(result.exitCode).toBe(0);
      expect(result.result).toEqual({ initialized: true, bare: false });
      expect(logs).toContain("Initialized repository");
    });

    it("should initialize bare repository", async () => {
      const { cli } = createGitCli();
      const result = await runMain(cli, { argv: ["init", "--bare"] });

      expect(result.exitCode).toBe(0);
      expect(result.result).toEqual({ initialized: true, bare: true });
      expect(logs).toContain("Initialized bare repository");
    });

    it("should add and commit files", async () => {
      const { cli, state } = createGitCli();

      await runMain(cli, { argv: ["add", "file.txt"] });
      expect(logs).toContain("Added file.txt");
      expect(state.staged).toContain("file.txt");

      const result = await runMain(cli, { argv: ["commit", "-m", "Initial commit"] });
      expect(result.exitCode).toBe(0);
      expect(logs).toContain("Committed: Initial commit");
      expect(state.commits).toContain("Initial commit");
    });

    it("should add all files with -A flag", async () => {
      const { cli, state } = createGitCli();

      await runMain(cli, { argv: ["add", ".", "-A"] });
      expect(logs).toContain("Added all files");
      expect(state.staged).toContain("*");
    });

    it("should show commit log", async () => {
      const { cli, state } = createGitCli();
      state.commits = ["First", "Second", "Third"];

      await runMain(cli, { argv: ["log", "-n", "2", "--oneline"] });
      expect(logs).toContain("Third");
      expect(logs).toContain("Second");
      expect(logs).not.toContain("First");
    });
  });

  describe("npm-like CLI", () => {
    const createNpmCli = () => {
      const installed: string[] = [];
      const scripts: Record<string, string> = {
        test: "vitest",
        build: "tsc",
        lint: "eslint",
      };

      const installCmd = defineCommand({
        name: "install",
        description: "Install packages",
        args: z.object({
          package: arg(z.string().optional(), {
            positional: true,
            description: "Package to install",
          }),
          dev: arg(z.boolean().default(false), {
            alias: "D",
            description: "Install as dev dependency",
          }),
          global: arg(z.boolean().default(false), { alias: "g", description: "Install globally" }),
        }),
        run: ({ args }) => {
          if (args.package) {
            const prefix = args.dev ? "(dev) " : args.global ? "(global) " : "";
            installed.push(`${prefix}${args.package}`);
            console.log(`Installing ${prefix}${args.package}...`);
          } else {
            console.log("Installing all dependencies...");
          }
          return { installed: args.package ?? "all" };
        },
      });

      const runCmd = defineCommand({
        name: "run",
        description: "Run a script",
        args: z.object({
          script: arg(z.string(), { positional: true, description: "Script name" }),
        }),
        run: ({ args }) => {
          const script = scripts[args.script];
          if (script) {
            console.log(`> ${script}`);
            return { script: args.script, command: script };
          } else {
            console.log(`Script "${args.script}" not found`);
            return { error: "not found" };
          }
        },
      });

      const testCmd = defineCommand({
        name: "test",
        description: "Run tests",
        args: z.object({
          watch: arg(z.boolean().default(false), { alias: "w", description: "Watch mode" }),
          coverage: arg(z.boolean().default(false), {
            alias: "c",
            description: "Collect coverage",
          }),
        }),
        run: ({ args }) => {
          let cmd = "vitest";
          if (args.watch) cmd += " --watch";
          if (args.coverage) cmd += " --coverage";
          console.log(`> ${cmd}`);
          return { command: cmd };
        },
      });

      return {
        cli: defineCommand({
          name: "npm",
          version: "1.0.0",
          description: "A simple npm-like CLI",
          subCommands: {
            install: installCmd,
            i: installCmd, // alias
            run: runCmd,
            test: testCmd,
            t: testCmd, // alias
          },
        }),
        installed,
      };
    };

    it("should install a package", async () => {
      const { cli, installed } = createNpmCli();

      await runMain(cli, { argv: ["install", "lodash"] });
      expect(logs).toContain("Installing lodash...");
      expect(installed).toContain("lodash");
    });

    it("should install dev dependency", async () => {
      const { cli, installed } = createNpmCli();

      await runMain(cli, { argv: ["install", "vitest", "-D"] });
      expect(logs).toContain("Installing (dev) vitest...");
      expect(installed).toContain("(dev) vitest");
    });

    it("should install globally", async () => {
      const { cli, installed } = createNpmCli();

      await runMain(cli, { argv: ["i", "typescript", "-g"] });
      expect(logs).toContain("Installing (global) typescript...");
      expect(installed).toContain("(global) typescript");
    });

    it("should run scripts", async () => {
      const { cli } = createNpmCli();

      const result = await runMain(cli, { argv: ["run", "build"] });
      expect(logs).toContain("> tsc");
      expect(result.result).toEqual({ script: "build", command: "tsc" });
    });

    it("should run tests with options", async () => {
      const { cli } = createNpmCli();

      const result = await runMain(cli, { argv: ["test", "-w", "-c"] });
      expect(logs).toContain("> vitest --watch --coverage");
      expect(result.result).toEqual({ command: "vitest --watch --coverage" });
    });
  });

  describe("File processor CLI", () => {
    const createProcessorCli = () => {
      const processed: Array<{ input: string; output: string; options: unknown }> = [];

      return {
        cli: defineCommand({
          name: "process",
          version: "2.0.0",
          description: "Process files with various transformations",
          args: z.object({
            input: arg(z.string(), {
              positional: true,
              description: "Input file",
              placeholder: "INPUT",
            }),
            output: arg(z.string(), {
              alias: "o",
              description: "Output file",
              placeholder: "OUTPUT",
            }),
            format: arg(z.enum(["json", "yaml", "xml"]).default("json"), {
              alias: "f",
              description: "Output format",
            }),
            minify: arg(z.boolean().default(false), { alias: "m", description: "Minify output" }),
            indent: arg(z.coerce.number().default(2), {
              alias: "i",
              description: "Indentation level",
            }),
            verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose output" }),
          }),
          run: ({ args }) => {
            processed.push({
              input: args.input,
              output: args.output,
              options: {
                format: args.format,
                minify: args.minify,
                indent: args.indent,
              },
            });

            if (args.verbose) {
              console.log(`Reading ${args.input}...`);
              console.log(`Format: ${args.format}`);
              console.log(`Minify: ${args.minify}`);
              console.log(`Indent: ${args.indent}`);
            }

            console.log(`Processed ${args.input} → ${args.output}`);
            return { success: true, format: args.format };
          },
        }),
        processed,
      };
    };

    it("should process file with default options", async () => {
      const { cli, processed } = createProcessorCli();

      const result = await runMain(cli, {
        argv: ["data.csv", "-o", "data.json"],
      });

      expect(result.exitCode).toBe(0);
      expect(logs).toContain("Processed data.csv → data.json");
      expect(processed[0]).toEqual({
        input: "data.csv",
        output: "data.json",
        options: { format: "json", minify: false, indent: 2 },
      });
    });

    it("should process with custom format and minify", async () => {
      const { cli, processed } = createProcessorCli();

      await runMain(cli, {
        argv: ["data.json", "-o", "data.yaml", "-f", "yaml", "-m"],
      });

      expect(processed[0]?.options).toEqual({
        format: "yaml",
        minify: true,
        indent: 2,
      });
    });

    it("should show verbose output", async () => {
      const { cli } = createProcessorCli();

      await runMain(cli, {
        argv: ["input.xml", "-o", "output.json", "-v", "-i", "4"],
      });

      expect(logs).toContain("Reading input.xml...");
      expect(logs).toContain("Format: json");
      expect(logs).toContain("Indent: 4");
    });

    it("should reject invalid format", async () => {
      const { cli } = createProcessorCli();

      const result = await runMain(cli, {
        argv: ["data.csv", "-o", "out.txt", "-f", "invalid"],
      });

      expect(result.exitCode).toBe(1);
    });
  });

  describe("Server CLI", () => {
    const createServerCli = () => {
      let serverConfig: unknown = null;

      const startCmd = defineCommand({
        name: "start",
        description: "Start the server",
        args: z.object({
          port: arg(
            z.coerce
              .number()
              .refine((n) => n >= 1 && n <= 65535, "Port must be between 1 and 65535"),
            { alias: "p", description: "Port to listen on" },
          ),
          host: arg(z.string().default("localhost"), {
            alias: "H",
            overrideBuiltinAlias: true,
            description: "Host to bind to",
          }),
          workers: arg(z.coerce.number().default(1), {
            alias: "w",
            description: "Number of workers",
          }),
          ssl: arg(z.boolean().default(false), { description: "Enable SSL" }),
          cert: arg(z.string().optional(), { description: "SSL certificate path" }),
          key: arg(z.string().optional(), { description: "SSL key path" }),
        }),
        setup: ({ args }) => {
          if (args.ssl && (!args.cert || !args.key)) {
            throw new Error("SSL requires both --cert and --key");
          }
        },
        run: ({ args }) => {
          serverConfig = args;
          const protocol = args.ssl ? "https" : "http";
          console.log(`Server starting on ${protocol}://${args.host}:${args.port}`);
          console.log(`Workers: ${args.workers}`);
          return { url: `${protocol}://${args.host}:${args.port}` };
        },
      });

      const stopCmd = defineCommand({
        name: "stop",
        description: "Stop the server",
        args: z.object({
          force: arg(z.boolean().default(false), { alias: "f", description: "Force stop" }),
          timeout: arg(z.coerce.number().default(30), {
            alias: "t",
            description: "Shutdown timeout in seconds",
          }),
        }),
        run: ({ args }) => {
          if (args.force) {
            console.log("Force stopping server...");
          } else {
            console.log(`Graceful shutdown (timeout: ${args.timeout}s)...`);
          }
          serverConfig = null;
          return { stopped: true };
        },
      });

      const statusCmd = defineCommand({
        name: "status",
        description: "Show server status",
        run: () => {
          if (serverConfig) {
            console.log("Server is running");
            return { running: true, config: serverConfig };
          } else {
            console.log("Server is stopped");
            return { running: false };
          }
        },
      });

      return {
        cli: defineCommand({
          name: "server",
          version: "3.0.0",
          description: "Server management CLI",
          subCommands: {
            start: startCmd,
            stop: stopCmd,
            status: statusCmd,
          },
        }),
        getConfig: () => serverConfig,
      };
    };

    it("should start server with required port", async () => {
      const { cli } = createServerCli();

      const result = await runMain(cli, { argv: ["start", "-p", "8080"] });

      expect(result.exitCode).toBe(0);
      expect(logs).toContain("Server starting on http://localhost:8080");
      expect(result.result).toEqual({ url: "http://localhost:8080" });
    });

    it("should start server with custom host and workers", async () => {
      const { cli } = createServerCli();

      await runMain(cli, {
        argv: ["start", "-p", "3000", "-H", "0.0.0.0", "-w", "4"],
      });

      expect(logs).toContain("Server starting on http://0.0.0.0:3000");
      expect(logs).toContain("Workers: 4");
    });

    it("should reject invalid port", async () => {
      const { cli } = createServerCli();

      const result = await runMain(cli, { argv: ["start", "-p", "99999"] });
      expect(result.exitCode).toBe(1);
    });

    it("should require cert and key for SSL", async () => {
      const { cli } = createServerCli();

      const result = await runMain(cli, {
        argv: ["start", "-p", "443", "--ssl"],
      });

      expect(result.exitCode).toBe(1);
    });

    it("should start with SSL when cert and key provided", async () => {
      const { cli } = createServerCli();

      const result = await runMain(cli, {
        argv: ["start", "-p", "443", "--ssl", "--cert", "/path/cert.pem", "--key", "/path/key.pem"],
      });

      expect(result.exitCode).toBe(0);
      expect(logs).toContain("Server starting on https://localhost:443");
    });

    it("should stop server gracefully", async () => {
      const { cli } = createServerCli();

      await runMain(cli, { argv: ["stop", "-t", "60"] });
      expect(logs).toContain("Graceful shutdown (timeout: 60s)...");
    });

    it("should force stop server", async () => {
      const { cli } = createServerCli();

      await runMain(cli, { argv: ["stop", "-f"] });
      expect(logs).toContain("Force stopping server...");
    });
  });

  describe("Database migration CLI", () => {
    const createMigrationCli = () => {
      const migrations = {
        pending: ["001_create_users", "002_add_email", "003_create_posts"],
        applied: [] as string[],
      };

      const upCmd = defineCommand({
        name: "up",
        description: "Run pending migrations",
        args: z.object({
          steps: arg(z.coerce.number().optional(), {
            alias: "n",
            description: "Number of migrations to run",
          }),
          dryRun: arg(z.boolean().default(false), {
            alias: "d",
            description: "Show migrations without running",
          }),
        }),
        run: ({ args }) => {
          const toApply = args.steps ? migrations.pending.slice(0, args.steps) : migrations.pending;

          if (args.dryRun) {
            console.log("Dry run - would apply:");
            toApply.forEach((m) => console.log(`  ${m}`));
            return { dryRun: true, migrations: toApply };
          }

          toApply.forEach((m) => {
            console.log(`Applying ${m}...`);
            migrations.applied.push(m);
          });
          migrations.pending = migrations.pending.slice(toApply.length);

          return { applied: toApply };
        },
      });

      const downCmd = defineCommand({
        name: "down",
        description: "Rollback migrations",
        args: z.object({
          steps: arg(z.coerce.number().default(1), {
            alias: "n",
            description: "Number of migrations to rollback",
          }),
        }),
        run: ({ args }) => {
          const toRollback = migrations.applied.slice(-args.steps).reverse();

          toRollback.forEach((m) => {
            console.log(`Rolling back ${m}...`);
            migrations.pending.unshift(m);
          });
          migrations.applied = migrations.applied.slice(0, -args.steps);

          return { rolledBack: toRollback };
        },
      });

      const statusCmd = defineCommand({
        name: "status",
        description: "Show migration status",
        run: () => {
          console.log(`Applied: ${migrations.applied.length}`);
          console.log(`Pending: ${migrations.pending.length}`);
          migrations.pending.forEach((m) => console.log(`  [ ] ${m}`));
          migrations.applied.forEach((m) => console.log(`  [x] ${m}`));
          return { applied: migrations.applied, pending: migrations.pending };
        },
      });

      return {
        cli: defineCommand({
          name: "migrate",
          version: "1.0.0",
          description: "Database migration tool",
          subCommands: {
            up: upCmd,
            down: downCmd,
            status: statusCmd,
          },
        }),
        migrations,
      };
    };

    it("should run all pending migrations", async () => {
      const { cli, migrations } = createMigrationCli();

      const result = await runMain(cli, { argv: ["up"] });

      expect(result.exitCode).toBe(0);
      expect(migrations.applied).toHaveLength(3);
      expect(migrations.pending).toHaveLength(0);
      expect(logs).toContain("Applying 001_create_users...");
    });

    it("should run specific number of migrations", async () => {
      const { cli, migrations } = createMigrationCli();

      await runMain(cli, { argv: ["up", "-n", "2"] });

      expect(migrations.applied).toHaveLength(2);
      expect(migrations.pending).toHaveLength(1);
    });

    it("should dry run migrations", async () => {
      const { cli, migrations } = createMigrationCli();

      const result = await runMain(cli, { argv: ["up", "-d"] });

      expect(migrations.applied).toHaveLength(0);
      expect(logs).toContain("Dry run - would apply:");
      expect(result.result).toEqual({
        dryRun: true,
        migrations: ["001_create_users", "002_add_email", "003_create_posts"],
      });
    });

    it("should rollback migrations", async () => {
      const { cli, migrations } = createMigrationCli();
      migrations.applied = ["001_create_users", "002_add_email"];
      migrations.pending = ["003_create_posts"];

      await runMain(cli, { argv: ["down", "-n", "1"] });

      expect(migrations.applied).toHaveLength(1);
      expect(migrations.pending).toHaveLength(2);
      expect(logs).toContain("Rolling back 002_add_email...");
    });

    it("should show migration status", async () => {
      const { cli, migrations } = createMigrationCli();
      migrations.applied = ["001_create_users"];
      migrations.pending = ["002_add_email", "003_create_posts"];

      const result = await runMain(cli, { argv: ["status"] });

      expect(logs).toContain("Applied: 1");
      expect(logs).toContain("Pending: 2");
      expect(result.result).toEqual({
        applied: ["001_create_users"],
        pending: ["002_add_email", "003_create_posts"],
      });
    });
  });
});
