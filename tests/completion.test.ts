import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  CompletionDirective,
  createCompletionCommand,
  createDynamicCompleteCommand,
  extractCompletionData,
  formatOutput,
  generateCandidates,
  generateCompletion,
  getSupportedShells,
  parseCompletionContext,
  withCompletionCommand,
} from "../src/completion/index.js";
import { arg, defineCommand, runCommand } from "../src/index.js";

describe("Completion", () => {
  describe("extractCompletionData", () => {
    it("should extract options from a simple command", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          verbose: arg(z.boolean().default(false), {
            alias: "v",
            description: "Enable verbose output",
          }),
          output: arg(z.string(), {
            alias: "o",
            description: "Output file path",
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      expect(data.programName).toBe("test");
      expect(data.command.options).toHaveLength(2);

      const verboseOpt = data.command.options.find((o) => o.name === "verbose");
      expect(verboseOpt).toBeDefined();
      expect(verboseOpt?.alias).toBe("v");
      expect(verboseOpt?.description).toBe("Enable verbose output");
      expect(verboseOpt?.takesValue).toBe(false); // boolean flag

      const outputOpt = data.command.options.find((o) => o.name === "output");
      expect(outputOpt).toBeDefined();
      expect(outputOpt?.alias).toBe("o");
      expect(outputOpt?.takesValue).toBe(true); // string requires value
    });

    it("should extract subcommands", () => {
      const buildCmd = defineCommand({
        name: "build",
        description: "Build the project",
        args: z.object({
          watch: arg(z.boolean().default(false), { alias: "w" }),
        }),
        run: () => {},
      });

      const testCmd = defineCommand({
        name: "test",
        description: "Run tests",
        run: () => {},
      });

      const mainCmd = defineCommand({
        name: "mycli",
        description: "My CLI tool",
        subCommands: {
          build: buildCmd,
          test: testCmd,
        },
      });

      const data = extractCompletionData(mainCmd, "mycli");

      expect(data.command.subcommands).toHaveLength(2);

      const buildSub = data.command.subcommands.find((s) => s.name === "build");
      expect(buildSub).toBeDefined();
      expect(buildSub?.description).toBe("Build the project");
      expect(buildSub?.options).toHaveLength(1);

      const testSub = data.command.subcommands.find((s) => s.name === "test");
      expect(testSub).toBeDefined();
      expect(testSub?.description).toBe("Run tests");
    });

    it("should handle nested subcommands", () => {
      const listCmd = defineCommand({
        name: "list",
        description: "List plugins",
        run: () => {},
      });

      const addCmd = defineCommand({
        name: "add",
        description: "Add a plugin",
        args: z.object({
          name: arg(z.string(), { positional: true }),
        }),
        run: () => {},
      });

      const pluginCmd = defineCommand({
        name: "plugin",
        description: "Plugin management",
        subCommands: {
          list: listCmd,
          add: addCmd,
        },
      });

      const mainCmd = defineCommand({
        name: "mycli",
        subCommands: {
          plugin: pluginCmd,
        },
      });

      const data = extractCompletionData(mainCmd, "mycli");

      const pluginSub = data.command.subcommands.find((s) => s.name === "plugin");
      expect(pluginSub).toBeDefined();
      expect(pluginSub?.subcommands).toHaveLength(2);
    });

    it("should not include positional arguments as options", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          file: arg(z.string(), { positional: true, description: "File path" }),
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      // Only verbose should be in options (file is positional)
      expect(data.command.options).toHaveLength(1);
      expect(data.command.options[0]?.name).toBe("verbose");
    });

    it("should extract enum values from z.enum schema", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          format: arg(z.enum(["json", "yaml", "xml"]), {
            alias: "f",
            description: "Output format",
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const formatOpt = data.command.options.find((o) => o.name === "format");
      expect(formatOpt).toBeDefined();
      expect(formatOpt?.valueCompletion).toBeDefined();
      expect(formatOpt?.valueCompletion?.type).toBe("choices");
      expect(formatOpt?.valueCompletion?.choices).toEqual(["json", "yaml", "xml"]);
    });

    it("should use explicit custom completion over enum detection", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          format: arg(z.enum(["json", "yaml"]), {
            alias: "f",
            completion: {
              custom: { choices: ["custom1", "custom2"] },
            },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const formatOpt = data.command.options.find((o) => o.name === "format");
      expect(formatOpt?.valueCompletion?.type).toBe("choices");
      expect(formatOpt?.valueCompletion?.choices).toEqual(["custom1", "custom2"]);
    });

    it("should extract file completion metadata", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          config: arg(z.string(), {
            alias: "c",
            completion: { type: "file", extensions: ["json", "yaml"] },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const configOpt = data.command.options.find((o) => o.name === "config");
      expect(configOpt?.valueCompletion).toBeDefined();
      expect(configOpt?.valueCompletion?.type).toBe("file");
      expect(configOpt?.valueCompletion?.extensions).toEqual(["json", "yaml"]);
    });

    it("should extract directory completion metadata", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          outputDir: arg(z.string(), {
            alias: "o",
            completion: { type: "directory" },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const outputDirOpt = data.command.options.find((o) => o.name === "outputDir");
      expect(outputDirOpt?.valueCompletion?.type).toBe("directory");
    });

    it("should extract shell command completion metadata", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          branch: arg(z.string().optional(), {
            alias: "b",
            completion: {
              custom: { shellCommand: "git branch --format='%(refname:short)'" },
            },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const branchOpt = data.command.options.find((o) => o.name === "branch");
      expect(branchOpt?.valueCompletion?.type).toBe("command");
      expect(branchOpt?.valueCompletion?.shellCommand).toBe(
        "git branch --format='%(refname:short)'",
      );
    });

    it("should extract positional arguments with completion", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          input: arg(z.string(), {
            positional: true,
            description: "Input file",
            completion: { type: "file", extensions: ["txt", "md"] },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      expect(data.command.positionals).toHaveLength(1);
      const inputPos = data.command.positionals[0];
      expect(inputPos?.name).toBe("input");
      expect(inputPos?.valueCompletion?.type).toBe("file");
      expect(inputPos?.valueCompletion?.extensions).toEqual(["txt", "md"]);
    });

    it("should handle positional with enum completion", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          action: arg(z.enum(["start", "stop", "restart"]), {
            positional: true,
            description: "Action to perform",
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      expect(data.command.positionals).toHaveLength(1);
      const actionPos = data.command.positionals[0];
      expect(actionPos?.valueCompletion?.type).toBe("choices");
      expect(actionPos?.valueCompletion?.choices).toEqual(["start", "stop", "restart"]);
    });
  });

  describe("generateCompletion", () => {
    const testCommand = defineCommand({
      name: "mycli",
      description: "My CLI tool",
      args: z.object({
        verbose: arg(z.boolean().default(false), {
          alias: "v",
          description: "Verbose output",
        }),
        config: arg(z.string().optional(), {
          alias: "c",
          description: "Config file path",
        }),
      }),
      subCommands: {
        build: defineCommand({
          name: "build",
          description: "Build the project",
          args: z.object({
            watch: arg(z.boolean().default(false), {
              alias: "w",
              description: "Watch mode",
            }),
          }),
          run: () => {},
        }),
        test: defineCommand({
          name: "test",
          description: "Run tests",
          run: () => {},
        }),
      },
    });

    describe("bash completion", () => {
      it("should generate valid bash completion script", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.shell).toBe("bash");
        expect(result.script).toContain("# Bash completion for mycli");
        expect(result.script).toContain("_mycli_completions()");
        expect(result.script).toContain("complete -F _mycli_completions mycli");
        expect(result.script).toContain("mycli __complete");
      });

      it("should include installation instructions", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.installInstructions).toContain("~/.bashrc");
        expect(result.installInstructions).toContain("mycli completion bash");
      });
    });

    describe("zsh completion", () => {
      it("should generate valid zsh completion script", () => {
        const result = generateCompletion(testCommand, {
          shell: "zsh",
          programName: "mycli",
        });

        expect(result.shell).toBe("zsh");
        expect(result.script).toContain("#compdef mycli");
        expect(result.script).toContain("# Zsh completion for mycli");
        expect(result.script).toContain("_mycli()");
        expect(result.script).toContain("mycli __complete");
      });
    });

    describe("fish completion", () => {
      it("should generate valid fish completion script", () => {
        const result = generateCompletion(testCommand, {
          shell: "fish",
          programName: "mycli",
        });

        expect(result.shell).toBe("fish");
        expect(result.script).toContain("# Fish completion for mycli");
        expect(result.script).toContain("complete -c mycli");
        expect(result.script).toContain("__fish_mycli_complete");
        expect(result.script).toContain("mycli __complete");
      });
    });

    it("should throw error for unsupported shell", () => {
      expect(() =>
        generateCompletion(testCommand, {
          shell: "powershell" as any,
          programName: "mycli",
        }),
      ).toThrow("Unsupported shell: powershell");
    });
  });

  describe("getSupportedShells", () => {
    it("should return supported shells", () => {
      const shells = getSupportedShells();

      expect(shells).toContain("bash");
      expect(shells).toContain("zsh");
      expect(shells).toContain("fish");
      expect(shells).toHaveLength(3);
    });
  });

  describe("createCompletionCommand", () => {
    it("should create a valid completion subcommand", () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd, "mycli");

      expect(completionCmd.name).toBe("completion");
      expect(completionCmd.description).toBe("Generate shell completion script");
      expect(completionCmd.args).toBeDefined();
      expect(completionCmd.run).toBeDefined();
    });

    it("should use rootCommand.name as programName when not specified", () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd);

      expect(completionCmd.name).toBe("completion");
      expect(completionCmd.description).toBe("Generate shell completion script");
    });

    it("should be usable as a subcommand", () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd, "mycli");

      const cmdWithCompletion = defineCommand({
        name: "mycli",
        subCommands: {
          completion: completionCmd,
        },
      });

      expect(cmdWithCompletion.subCommands?.completion).toBe(completionCmd);
    });
  });

  describe("withCompletionCommand", () => {
    it("should wrap a command with a completion subcommand", () => {
      const cmd = defineCommand({
        name: "mycli",
        description: "My CLI tool",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.name).toBe("mycli");
      expect(wrapped.description).toBe("My CLI tool");
      expect(wrapped.subCommands?.build).toBe(cmd.subCommands?.build);
      expect(wrapped.subCommands?.completion).toBeDefined();

      const completionCmd = wrapped.subCommands?.completion;
      expect(typeof completionCmd).toBe("object");
      if (typeof completionCmd === "object") {
        expect(completionCmd.name).toBe("completion");
      }
    });

    it("should use command.name as programName by default", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          test: defineCommand({ name: "test", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.subCommands?.completion).toBeDefined();
    });

    it("should preserve existing subcommands", () => {
      const buildCmd = defineCommand({ name: "build", run: () => {} });
      const testCmd = defineCommand({ name: "test", run: () => {} });

      const cmd = defineCommand({
        name: "mycli",
        subCommands: { build: buildCmd, test: testCmd },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.subCommands?.build).toBe(buildCmd);
      expect(wrapped.subCommands?.test).toBe(testCmd);
      expect(wrapped.subCommands?.completion).toBeDefined();
    });

    it("should generate completion from the wrapped command tree", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);
      wrapped.subCommands = {
        ...wrapped.subCommands,
        deploy: defineCommand({ name: "deploy", run: () => {} }),
      };

      const completionSubcommand = wrapped.subCommands?.completion;
      expect(completionSubcommand).toBeDefined();
      if (!completionSubcommand || typeof completionSubcommand === "function") {
        throw new Error("Expected completion to be a command object");
      }

      expect(completionSubcommand.run).toBeDefined();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      completionSubcommand.run?.({ shell: "bash", instructions: false });

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");
      consoleSpy.mockRestore();
      // Dynamic script calls __complete at runtime, so it contains the program name and __complete
      expect(output).toContain("mycli __complete");
      expect(output).toContain("_mycli_completions");
    });

    it("should always include __complete command", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);

      expect(wrapped.subCommands?.__complete).toBeDefined();
      expect(wrapped.subCommands?.completion).toBeDefined();
    });

    it("should hide __complete from help output", async () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          build: defineCommand({ name: "build", run: () => {} }),
        },
      });

      const wrapped = withCompletionCommand(cmd);
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});

      await runCommand(wrapped, ["--help"]);

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");

      consoleSpy.mockRestore();

      expect(output).toContain("build");
      expect(output).toContain("completion");
      expect(output).not.toContain("__complete");
    });
  });

  describe("Dynamic Completion", () => {
    describe("parseCompletionContext", () => {
      const testCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
          format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
        }),
        subCommands: {
          build: defineCommand({
            name: "build",
            args: z.object({
              watch: arg(z.boolean().default(false), { alias: "w" }),
              output: arg(z.string().optional(), { alias: "o" }),
            }),
            run: () => {},
          }),
          test: defineCommand({
            name: "test",
            run: () => {},
          }),
        },
      });

      it("should detect subcommand completion at root level", () => {
        const ctx = parseCompletionContext([""], testCmd);

        expect(ctx.completionType).toBe("subcommand");
        expect(ctx.subcommands).toContain("build");
        expect(ctx.subcommands).toContain("test");
        expect(ctx.currentWord).toBe("");
      });

      it("should detect option-name completion when starting with -", () => {
        const ctx = parseCompletionContext(["--"], testCmd);

        expect(ctx.completionType).toBe("option-name");
        expect(ctx.currentWord).toBe("--");
      });

      it("should detect option-value completion after option", () => {
        const ctx = parseCompletionContext(["--format", ""], testCmd);

        expect(ctx.completionType).toBe("option-value");
        expect(ctx.targetOption?.cliName).toBe("format");
      });

      it("should navigate into subcommand", () => {
        const ctx = parseCompletionContext(["build", "--"], testCmd);

        expect(ctx.subcommandPath).toEqual(["build"]);
        expect(ctx.completionType).toBe("option-name");
        expect(ctx.options.some((o) => o.cliName === "watch")).toBe(true);
      });

      it("should track used options", () => {
        const ctx = parseCompletionContext(["--verbose", "--"], testCmd);

        expect(ctx.usedOptions.has("verbose")).toBe(true);
        expect(ctx.usedOptions.has("v")).toBe(true);
      });

      it("should handle option with inline value", () => {
        const ctx = parseCompletionContext(["--format="], testCmd);

        expect(ctx.completionType).toBe("option-value");
        expect(ctx.targetOption?.cliName).toBe("format");
      });
    });

    describe("generateCandidates", () => {
      const testCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
          format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
          config: arg(z.string().optional(), { completion: { type: "file" } }),
          dir: arg(z.string().optional(), { completion: { type: "directory" } }),
        }),
        subCommands: {
          build: defineCommand({ name: "build", description: "Build project", run: () => {} }),
          test: defineCommand({ name: "test", description: "Run tests", run: () => {} }),
        },
      });

      it("should generate subcommand candidates", () => {
        const ctx = parseCompletionContext([""], testCmd);
        const result = generateCandidates(ctx);

        const subcommandCandidates = result.candidates.filter((c) => c.type === "subcommand");
        expect(subcommandCandidates.some((c) => c.value === "build")).toBe(true);
        expect(subcommandCandidates.some((c) => c.value === "test")).toBe(true);
      });

      it("should generate option candidates", () => {
        const ctx = parseCompletionContext(["--"], testCmd);
        const result = generateCandidates(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--verbose")).toBe(true);
        expect(optionCandidates.some((c) => c.value === "--format")).toBe(true);
      });

      it("should generate enum value candidates for option-value", () => {
        const ctx = parseCompletionContext(["--format", ""], testCmd);
        const result = generateCandidates(ctx);

        expect(result.candidates.some((c) => c.value === "json")).toBe(true);
        expect(result.candidates.some((c) => c.value === "yaml")).toBe(true);
      });

      it("should set file directive for file completion", () => {
        const ctx = parseCompletionContext(["--config", ""], testCmd);
        const result = generateCandidates(ctx);

        expect(result.directive & CompletionDirective.FileCompletion).toBeTruthy();
      });

      it("should set directory directive for directory completion", () => {
        const ctx = parseCompletionContext(["--dir", ""], testCmd);
        const result = generateCandidates(ctx);

        expect(result.directive & CompletionDirective.DirectoryCompletion).toBeTruthy();
      });

      it("should filter out used options", () => {
        const ctx = parseCompletionContext(["--verbose", "--"], testCmd);
        const result = generateCandidates(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--verbose")).toBe(false);
      });
    });

    describe("formatOutput", () => {
      it("should format candidates with descriptions", () => {
        const result = {
          candidates: [
            { value: "build", description: "Build project", type: "subcommand" as const },
            { value: "test", description: "Run tests", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatOutput(result);
        const lines = output.split("\n");

        expect(lines[0]).toBe("build\tBuild project");
        expect(lines[1]).toBe("test\tRun tests");
        expect(lines[2]).toBe(":4"); // FilterPrefix = 4
      });

      it("should format candidates without descriptions", () => {
        const result = {
          candidates: [{ value: "json" }, { value: "yaml" }],
          directive: CompletionDirective.Default,
        };

        const output = formatOutput(result);
        const lines = output.split("\n");

        expect(lines[0]).toBe("json");
        expect(lines[1]).toBe("yaml");
        expect(lines[2]).toBe(":0");
      });
    });

    describe("createDynamicCompleteCommand", () => {
      it("should create __complete command", () => {
        const mainCmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const completeCmd = createDynamicCompleteCommand(mainCmd);

        expect(completeCmd.name).toBe("__complete");
        expect(completeCmd.run).toBeDefined();
      });

      it("should output completion candidates when run", () => {
        const mainCmd = defineCommand({
          name: "mycli",
          args: z.object({
            format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
          }),
          run: () => {},
        });

        const completeCmd = createDynamicCompleteCommand(mainCmd);

        const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        completeCmd.run?.({ args: ["--format", ""] });

        const output = consoleSpy.mock.calls
          .map((args) => args.map((value) => String(value)).join(" "))
          .join("\n");
        consoleSpy.mockRestore();

        expect(output).toContain("json");
        expect(output).toContain("yaml");
      });
    });

    describe("completion scripts", () => {
      it("should generate bash script that calls __complete", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.script).toContain("# Bash completion for mycli");
        expect(result.script).toContain("mycli __complete");
        expect(result.script).toContain("_mycli_completions");
      });

      it("should generate zsh script that calls __complete", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "zsh",
          programName: "mycli",
        });

        expect(result.script).toContain("# Zsh completion for mycli");
        expect(result.script).toContain("mycli __complete");
        expect(result.script).toContain("#compdef mycli");
      });

      it("should generate fish script that calls __complete", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "fish",
          programName: "mycli",
        });

        expect(result.script).toContain("# Fish completion for mycli");
        expect(result.script).toContain("mycli __complete");
        expect(result.script).toContain("__fish_mycli_complete");
      });

      it("should include shellCommand completion handling in bash script", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            branch: arg(z.string().optional(), {
              completion: {
                custom: { shellCommand: "git branch --format='%(refname:short)'" },
              },
            }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.script).toContain("__command:");
        expect(result.script).toContain("command_completion");
      });

      it("should include shellCommand completion handling in zsh script", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            branch: arg(z.string().optional(), {
              completion: {
                custom: { shellCommand: "git branch --format='%(refname:short)'" },
              },
            }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "zsh",
          programName: "mycli",
        });

        expect(result.script).toContain("__command:");
        expect(result.script).toContain("command_completion");
      });

      it("should include shellCommand completion handling in fish script", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            branch: arg(z.string().optional(), {
              completion: {
                custom: { shellCommand: "git branch --format='%(refname:short)'" },
              },
            }),
          }),
          run: () => {},
        });

        const result = generateCompletion(cmd, {
          shell: "fish",
          programName: "mycli",
        });

        expect(result.script).toContain("__command:");
        expect(result.script).toContain("command_completion");
      });
    });
  });
});
