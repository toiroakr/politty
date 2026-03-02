import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import {
  CompletionDirective,
  createCompletionCommand,
  createDynamicCompleteCommand,
  extractCompletionData,
  formatForShell,
  generateCandidates,
  generateCompletion,
  getSupportedShells,
  parseCompletionContext,
  withCompletionCommand,
} from "../src/completion/index.js";
import {
  arg,
  defineCommand,
  isLazyCommand,
  lazy,
  runCommand,
  type CompletionMeta,
} from "../src/index.js";

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

    it("should extract file completion metadata with matcher", () => {
      const cmd = defineCommand({
        name: "test",
        args: z.object({
          envFile: arg(z.string(), {
            completion: { type: "file", matcher: [".env.*"] },
          }),
        }),
        run: () => {},
      });

      const data = extractCompletionData(cmd, "test");

      const envFileOpt = data.command.options.find((o) => o.name === "envFile");
      expect(envFileOpt?.valueCompletion).toBeDefined();
      expect(envFileOpt?.valueCompletion?.type).toBe("file");
      expect(envFileOpt?.valueCompletion?.matcher).toEqual([".env.*"]);
      expect(envFileOpt?.valueCompletion?.extensions).toBeUndefined();
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

    it("should extract full metadata from lazy() subcommands", () => {
      const lazyCmd = lazy(
        defineCommand({
          name: "deploy",
          description: "Deploy the application",
          args: z.object({
            env: arg(z.enum(["dev", "staging", "prod"]), {
              description: "Target environment",
            }),
          }),
        }),
        async () => defineCommand({ name: "deploy", run: () => {} }),
      );

      const cmd = defineCommand({
        name: "mycli",
        subCommands: { deploy: lazyCmd },
      });

      const data = extractCompletionData(cmd, "mycli");

      expect(data.command.subcommands).toHaveLength(1);
      const deploySub = data.command.subcommands[0];
      expect(deploySub?.name).toBe("deploy");
      expect(deploySub?.description).toBe("Deploy the application");
      expect(deploySub?.options).toHaveLength(1);
      expect(deploySub?.options[0]?.name).toBe("env");
      expect(deploySub?.options[0]?.valueCompletion?.type).toBe("choices");
      expect(deploySub?.options[0]?.valueCompletion?.choices).toEqual(["dev", "staging", "prod"]);
    });

    it("should still produce placeholder for legacy async subcommands", () => {
      const cmd = defineCommand({
        name: "mycli",
        subCommands: {
          legacy: async () => defineCommand({ name: "legacy", description: "Legacy command" }),
        },
      });

      const data = extractCompletionData(cmd, "mycli");

      expect(data.command.subcommands).toHaveLength(1);
      const legacySub = data.command.subcommands[0];
      expect(legacySub?.name).toBe("legacy");
      expect(legacySub?.description).toBe("(lazy loaded)");
      expect(legacySub?.options).toHaveLength(0);
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
        expect(result.script).toContain("complete -o default -F _mycli_completions mycli");
      });

      it("should include installation instructions", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.installInstructions).toContain("~/.bashrc");
        expect(result.installInstructions).toContain("mycli completion bash");
      });

      it("should not contain __command or __extensions handling", () => {
        const result = generateCompletion(testCommand, {
          shell: "bash",
          programName: "mycli",
        });

        expect(result.script).not.toContain("__command:");
        expect(result.script).not.toContain("__extensions:");
        expect(result.script).not.toContain("command_completion");
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
        expect(result.script).toContain("compdef _mycli mycli");
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
        expect(result.script).toContain("complete -c mycli -f");
      });
    });

    describe("matcher in static scripts", () => {
      const matcherCmd = defineCommand({
        name: "mycli",
        args: z.object({
          envFile: arg(z.string().optional(), {
            alias: "e",
            completion: { type: "file", matcher: [".env.*"] },
          }),
        }),
        run: () => {},
      });

      it("should generate bash glob pattern filter for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "bash",
          programName: "mycli",
        });
        expect(result.script).toContain('[[ "${_f##*/}" == .env.* ]]');
      });

      it("should generate zsh _files -g for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "zsh",
          programName: "mycli",
        });
        expect(result.script).toContain('_files -g ".env.*"');
      });

      it("should generate fish glob expansion for matcher", () => {
        const result = generateCompletion(matcherCmd, {
          shell: "fish",
          programName: "mycli",
        });
        expect(result.script).toContain('"$_dir".env.*');
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

    it("should add __complete command and output candidates", async () => {
      const mainCmd = defineCommand({
        name: "mycli",
        args: z.object({
          format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
        }),
        run: () => {},
      });

      const completionCmd = createCompletionCommand(mainCmd, "mycli");
      mainCmd.subCommands = { ...mainCmd.subCommands, completion: completionCmd };

      expect(mainCmd.subCommands?.__complete).toBeDefined();

      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      await runCommand(mainCmd, ["__complete", "--shell", "fish", "--", "--format", ""]);

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");
      consoleSpy.mockRestore();

      expect(output).toContain("json");
      expect(output).toContain("yaml");
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
      if (typeof completionCmd === "object" && !isLazyCommand(completionCmd)) {
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
      if (
        !completionSubcommand ||
        typeof completionSubcommand === "function" ||
        isLazyCommand(completionSubcommand)
      ) {
        throw new Error("Expected completion to be a command object");
      }

      expect(completionSubcommand.run).toBeDefined();
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      completionSubcommand.run?.({ shell: "bash", instructions: false });

      const output = consoleSpy.mock.calls
        .map((args) => args.map((value) => String(value)).join(" "))
        .join("\n");
      consoleSpy.mockRestore();
      // Static script embeds completion metadata
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

      it("should treat arguments after -- as positional", () => {
        const positionalCmd = defineCommand({
          name: "mycli",
          args: z.object({
            target: arg(z.string().optional(), { positional: true }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--", "foo", "-"], positionalCmd);

        expect(ctx.currentWord).toBe("-");
        expect(ctx.completionType).toBe("positional");
      });
    });

    describe("generateCandidates", () => {
      const testCmd = defineCommand({
        name: "mycli",
        args: z.object({
          verbose: arg(z.boolean().default(false), { alias: "v" }),
          format: arg(z.enum(["json", "yaml"]), { alias: "f" }),
          tags: arg(z.array(z.string()).default([]), { alias: "t" }),
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

      it("should set file directive for file completion without extensions", () => {
        const ctx = parseCompletionContext(["--config", ""], testCmd);
        const result = generateCandidates(ctx);

        expect(result.directive & CompletionDirective.FileCompletion).toBeTruthy();
      });

      it("should pass file extensions to shell via metadata instead of resolving in JS", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            config: arg(z.string().optional(), {
              completion: { type: "file", extensions: ["json", "yaml"] },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--config", ""], cmd);
        const result = generateCandidates(ctx);

        // Should NOT have any file candidates resolved in JS
        expect(result.candidates).toHaveLength(0);
        // Should NOT have FileCompletion directive (shell uses @ext: metadata instead)
        expect(result.directive & CompletionDirective.FileCompletion).toBeFalsy();
        // Should have fileExtensions metadata for shell-native completion
        expect(result.fileExtensions).toEqual(["json", "yaml"]);
      });

      it("should pass file matchers to shell via metadata instead of resolving in JS", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            envFile: arg(z.string().optional(), {
              completion: { type: "file", matcher: [".env.*"] },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--env-file", ""], cmd);
        const result = generateCandidates(ctx);

        // Should NOT have any file candidates resolved in JS
        expect(result.candidates).toHaveLength(0);
        // Should NOT have FileCompletion directive (shell uses @matcher: metadata instead)
        expect(result.directive & CompletionDirective.FileCompletion).toBeFalsy();
        // Should have fileMatchers metadata for shell-native completion
        expect(result.fileMatchers).toEqual([".env.*"]);
        // Should NOT have fileExtensions
        expect(result.fileExtensions).toBeUndefined();
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

      it("should keep array options available after they are used", () => {
        const ctx = parseCompletionContext(["--tags", "one", "--"], testCmd);
        const result = generateCandidates(ctx);

        const optionCandidates = result.candidates.filter((c) => c.type === "option");
        expect(optionCandidates.some((c) => c.value === "--tags")).toBe(true);
      });

      it("should set NoFileCompletion for enum value completion", () => {
        const ctx = parseCompletionContext(["--format", ""], testCmd);
        const result = generateCandidates(ctx);

        expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      });

      it("should set NoFileCompletion for custom choices completion", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            env: arg(z.string(), {
              completion: { custom: { choices: ["dev", "staging", "prod"] } },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--env", ""], cmd);
        const result = generateCandidates(ctx);

        expect(result.directive & CompletionDirective.NoFileCompletion).toBeTruthy();
      });

      it("should resolve shellCommand in JS instead of using markers", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            item: arg(z.string().optional(), {
              completion: {
                custom: { shellCommand: "printf 'foo\\nbar\\nbaz'" },
              },
            }),
          }),
          run: () => {},
        });

        const ctx = parseCompletionContext(["--item", ""], cmd);
        const result = generateCandidates(ctx);

        // Should NOT have __command: marker
        expect(result.candidates.some((c) => c.value.startsWith("__command:"))).toBe(false);
        // Should have resolved candidates from the shell command
        expect(result.candidates.some((c) => c.value === "foo")).toBe(true);
        expect(result.candidates.some((c) => c.value === "bar")).toBe(true);
        expect(result.candidates.some((c) => c.value === "baz")).toBe(true);
      });
    });

    describe("formatForShell", () => {
      it("should format for fish with descriptions", () => {
        const result = {
          candidates: [
            { value: "build", description: "Build project", type: "subcommand" as const },
            { value: "test", description: "Run tests", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "fish", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("build\tBuild project");
        expect(lines[1]).toBe("test\tRun tests");
        expect(lines[2]).toBe(":4"); // FilterPrefix = 4
      });

      it("should format for fish without descriptions", () => {
        const result = {
          candidates: [{ value: "json" }, { value: "yaml" }],
          directive: CompletionDirective.Default,
        };

        const output = formatForShell(result, { shell: "fish", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("json");
        expect(lines[1]).toBe("yaml");
        expect(lines[2]).toBe(":0");
      });

      it("should format for zsh with colon-separated descriptions", () => {
        const result = {
          candidates: [
            { value: "build", description: "Build project", type: "subcommand" as const },
            { value: "test", description: "Run tests", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "zsh", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("build:Build project");
        expect(lines[1]).toBe("test:Run tests");
        expect(lines[2]).toBe(":4");
      });

      it("should escape colons in zsh output", () => {
        const result = {
          candidates: [{ value: "http://example.com", description: "URL with: colons" }],
          directive: CompletionDirective.Default,
        };

        const output = formatForShell(result, { shell: "zsh", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("http\\://example.com:URL with\\: colons");
      });

      it("should format for bash with values only (no descriptions)", () => {
        const result = {
          candidates: [
            { value: "build", description: "Build project", type: "subcommand" as const },
            { value: "test", description: "Run tests", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });
        const lines = output.split("\n");

        expect(lines[0]).toBe("build");
        expect(lines[1]).toBe("test");
        expect(lines[2]).toBe(":4");
      });

      it("should filter by prefix for bash", () => {
        const result = {
          candidates: [
            { value: "build", type: "subcommand" as const },
            { value: "bench", type: "subcommand" as const },
            { value: "test", type: "subcommand" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "b" });
        const lines = output.split("\n");

        expect(lines).toContain("build");
        expect(lines).toContain("bench");
        expect(lines).not.toContain("test");
      });

      it("should prepend inline prefix for bash", () => {
        const result = {
          candidates: [
            { value: "json", type: "value" as const },
            { value: "yaml", type: "value" as const },
          ],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, {
          shell: "bash",
          currentWord: "",
          inlinePrefix: "--format=",
        });
        const lines = output.split("\n");

        expect(lines[0]).toBe("--format=json");
        expect(lines[1]).toBe("--format=yaml");
      });

      it("should include @matcher: metadata for file matchers", () => {
        const result: Parameters<typeof formatForShell>[0] = {
          candidates: [],
          directive: CompletionDirective.FilterPrefix,
          fileMatchers: [".env.*"],
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });
        const lines = output.split("\n");

        expect(lines).toContain("@matcher:.env.*");
      });

      it("should not include @matcher: when fileMatchers is empty", () => {
        const result: Parameters<typeof formatForShell>[0] = {
          candidates: [],
          directive: CompletionDirective.FilterPrefix,
        };

        const output = formatForShell(result, { shell: "bash", currentWord: "" });
        expect(output).not.toContain("@matcher:");
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
        completeCmd.run?.({ shell: "fish", args: ["--format", ""] });

        const output = consoleSpy.mock.calls
          .map((args) => args.map((value) => String(value)).join(" "))
          .join("\n");
        consoleSpy.mockRestore();

        expect(output).toContain("json");
        expect(output).toContain("yaml");
      });
    });

    describe("completion scripts", () => {
      it("should generate static bash completion script", () => {
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
        expect(result.script).toContain("_mycli_completions");
        expect(result.script).toContain("complete -o default -F _mycli_completions mycli");
      });

      it("should generate static zsh completion script", () => {
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
        expect(result.script).toContain("#compdef mycli");
        expect(result.script).toContain("compdef _mycli mycli");
      });

      it("should generate static fish completion script", () => {
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
        expect(result.script).toContain("__fish_mycli_complete");
        expect(result.script).toContain("complete -c mycli -f");
      });

      it("should generate valid script for command with no subcommands", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false), { alias: "v" }),
            output: arg(z.string().optional(), { alias: "o" }),
          }),
          run: () => {},
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

          // Should not contain empty else branch (bash/zsh syntax error)
          expect(result.script).not.toMatch(/else\s*\n\s*(fi|end)/);

          // Should still contain option completion
          expect(result.script).toContain("--verbose");
          expect(result.script).toContain("--output");
        }
      });

      it("should include opt_takes_value fallback for value-taking options without completion", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            config: arg(z.string().optional(), { alias: "c" }),
          }),
          subCommands: {
            build: defineCommand({ name: "build", run: () => {} }),
          },
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

          // Should contain opt_takes_value fallback check
          expect(result.script).toContain("opt_takes_value");
        }
      });

      it("should include root positional completion when no subcommands", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            file: arg(z.enum(["a.txt", "b.txt"]), {
              positional: true,
              description: "Input file",
            }),
          }),
          run: () => {},
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

          // Should contain positional value candidates in the root handler
          expect(result.script).toContain("a.txt");
          expect(result.script).toContain("b.txt");
        }
      });

      it("should escape shell-special characters in descriptions", () => {
        const cmd = defineCommand({
          name: "mycli",
          subCommands: {
            build: defineCommand({
              name: "build",
              description: 'Build "the" project ($var)',
              run: () => {},
            }),
          },
        });

        for (const shell of ["zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

          // Should not contain unescaped double quotes inside description strings
          // The raw description 'Build "the" project ($var)' should be escaped
          expect(result.script).not.toContain('Build "the"');
          expect(result.script).toContain('\\"the\\"');

          // Dollar sign should be escaped
          expect(result.script).not.toMatch(/\(\$var\)/);
          expect(result.script).toContain("\\$var");
        }
      });

      it("should keep array options always available in generated scripts", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            tags: arg(z.array(z.string()).default([]), {
              description: "Tags",
            }),
            name: arg(z.string().optional()),
          }),
          run: () => {},
        });

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, { shell, programName: "mycli" });

          // Array option --tags should NOT go through not_used filter
          expect(result.script).not.toMatch(/not_used.*"--tags"/);

          // Non-array option --name should still use not_used filter
          expect(result.script).toMatch(/not_used.*"--name"/);
        }
      });

      it("should reset used-options tracking when entering subcommand scope", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            verbose: arg(z.boolean().default(false)),
          }),
          subCommands: {
            build: defineCommand({
              name: "build",
              args: z.object({
                target: arg(z.string().optional()),
              }),
              run: () => {},
            }),
          },
        });

        const bashResult = generateCompletion(cmd, { shell: "bash", programName: "mycli" });
        // _used_opts should be reset when _subcmd is assigned
        expect(bashResult.script).toContain('_subcmd="$_w"; _used_opts=()');

        const zshResult = generateCompletion(cmd, { shell: "zsh", programName: "mycli" });
        expect(zshResult.script).toContain('_subcmd="$_w"; _used_opts=()');

        const fishResult = generateCompletion(cmd, { shell: "fish", programName: "mycli" });
        expect(fishResult.script).toContain('set _subcmd "$_w"; set _used_opts');
      });

      it("should escape special characters in choice values", () => {
        const cmd = defineCommand({
          name: "mycli",
          args: z.object({
            mode: arg(z.enum(["normal", 'say "hi"', "cost$5"]), {
              positional: true,
            }),
          }),
          run: () => {},
        });

        // Bash: choice values should be escaped in array literals
        const bashResult = generateCompletion(cmd, { shell: "bash", programName: "mycli" });
        expect(bashResult.script).toContain('say \\"hi\\"');
        expect(bashResult.script).toContain("cost\\$5");

        // Zsh: choice values should be escaped via escapeDesc
        const zshResult = generateCompletion(cmd, { shell: "zsh", programName: "mycli" });
        expect(zshResult.script).toContain('\\"hi\\"');
        expect(zshResult.script).toContain("\\$5");

        // Fish: choice values should be escaped via escapeDesc
        const fishResult = generateCompletion(cmd, { shell: "fish", programName: "mycli" });
        expect(fishResult.script).toContain('\\"hi\\"');
        expect(fishResult.script).toContain("\\$5");
      });

      it("should not include __command or __extensions handling in any shell script", () => {
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

        for (const shell of ["bash", "zsh", "fish"] as const) {
          const result = generateCompletion(cmd, {
            shell,
            programName: "mycli",
          });

          expect(result.script).not.toContain("__command:");
          expect(result.script).not.toContain("__extensions:");
          expect(result.script).not.toContain("command_completion");
        }
      });
    });
  });

  describe("CompletionMeta type constraints", () => {
    it("should accept extensions without matcher", () => {
      expectTypeOf<{ type: "file"; extensions: string[] }>().toMatchTypeOf<CompletionMeta>();
    });

    it("should accept matcher without extensions", () => {
      expectTypeOf<{ type: "file"; matcher: string[] }>().toMatchTypeOf<CompletionMeta>();
    });

    it("should reject both matcher and extensions", () => {
      expectTypeOf<{
        type: "file";
        matcher: string[];
        extensions: string[];
      }>().not.toMatchTypeOf<CompletionMeta>();
    });
  });
});
