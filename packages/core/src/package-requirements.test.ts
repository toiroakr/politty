import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "./core/arg-registry.js";
import { defineCommand } from "./core/command.js";
import { runCommand } from "./core/runner.js";
import { lazy } from "./lazy.js";
import { loadPackage, type PackageRequirement } from "./package-requirements.js";
import type { AnyCommand } from "./types.js";

describe("external package requirements", () => {
  it("reports installation guidance instead of executing a command with a missing package", async () => {
    let ran = false;
    const config = {
      name: "studio",
      requiredPackages: [
        {
          name: "@politty-test/missing-studio",
          install: "npm install -D @politty-test/missing-studio",
        },
      ],
      run: () => {
        ran = true;
      },
    };
    const result = await runCommand(defineCommand(config), []);
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error?.message).toContain("npm install -D @politty-test/missing-studio");
    expect(ran).toBe(false);
  });
});

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function fixture(source: string, exports: unknown = "./index.js") {
  const directory = await mkdtemp(join(tmpdir(), "politty-packages-"));
  directories.push(directory);
  const packageDirectory = join(directory, "node_modules", "@politty-test", "studio");
  await mkdir(packageDirectory, { recursive: true });
  await writeFile(
    join(packageDirectory, "package.json"),
    JSON.stringify({ name: "@politty-test/studio", type: "module", exports }),
  );
  await writeFile(join(packageDirectory, "index.js"), source);
  return {
    name: "@politty-test/studio",
    install: "npm install -D @politty-test/studio",
    from: pathToFileURL(join(directory, "cli.js")),
  };
}

describe("package loading", () => {
  it("loads packages attached to boolean arguments only when enabled", async () => {
    const command = defineCommand({
      name: "test",
      args: z.object({
        ui: arg(z.boolean().default(false), {
          requiredPackages: [{ name: "@politty-test/missing-ui" }],
        }),
      }),
      run: () => "tests",
    });
    expect((await runCommand(command, [])).result).toBe("tests");
    expect((await runCommand(command, ["--no-ui"])).result).toBe("tests");
    const enabled = await runCommand(command, ["--ui"]);
    expect(enabled.success).toBe(false);
    expect(enabled.error?.message).toContain('Package "@politty-test/missing-ui" is required.');
    const output: string[] = [];
    expect(
      (
        await runCommand(command, ["--ui", "--help"], {
          logger: { log: (text) => output.push(text), error: () => {} },
        })
      ).success,
    ).toBe(true);
    expect(output.join("\n")).toContain("@politty-test/missing-ui");
    output.length = 0;
    await runCommand(command, ["--help-json"], {
      logger: { log: (text) => output.push(text), error: () => {} },
    });
    expect(
      JSON.parse(output[0]!).options.find((field: { name: string }) => field.name === "ui")
        .requiredPackages[0].name,
    ).toBe("@politty-test/missing-ui");
  });

  it("activates argument requirements for true defaults before setup", async () => {
    let setup = false;
    const command = defineCommand({
      name: "test",
      args: z.object({
        ui: arg(z.boolean().default(true), {
          negation: true,
          requiredPackages: [{ name: "@politty-test/missing-ui" }],
        }),
      }),
      setup: () => {
        setup = true;
      },
      run: () => "tests",
    });
    expect((await runCommand(command, [])).success).toBe(false);
    expect(setup).toBe(false);
    expect((await runCommand(command, ["--no-ui"])).result).toBe("tests");
  });

  it("loads argument packages from the union option that accepted the args", async () => {
    let ran = false;
    const missing = [{ name: "@politty-test/missing-ui" }];
    const command = defineCommand({
      name: "test",
      args: z.union([
        z.object({ mode: z.literal("a"), name: z.string().optional() }),
        z.object({
          mode: z.literal("b"),
          config: arg(
            z.object({ port: arg(z.boolean().optional(), { requiredPackages: missing }) }),
            { flatten: "kebab" },
          ),
        }),
      ]),
      run: () => {
        ran = true;
      },
    });
    expect((await runCommand(command, ["--mode", "b", "--config-port"])).success).toBe(false);
    expect(ran).toBe(false);
  });

  it("only loads argument packages from the selected discriminated-union variant", async () => {
    const installed = await fixture("export const ready = true;");
    const command = defineCommand({
      name: "test",
      args: z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("tests"),
          ui: arg(z.boolean().default(true), { requiredPackages: [installed] }),
        }),
        z.object({
          mode: z.literal("ui"),
          ui: arg(z.boolean().default(true), {
            requiredPackages: [{ name: "@politty-test/missing-ui" }],
          }),
        }),
      ]),
      run: () => "tests",
    });
    expect((await runCommand(command, ["--mode", "tests"])).result).toBe("tests");
    expect((await runCommand(command, ["--mode", "ui"])).success).toBe(false);
  });

  it("loads packages declared on the selected discriminator without loading other branches", async () => {
    const command = defineCommand({
      name: "test",
      args: z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("tests") }),
        z.object({
          mode: arg(z.literal("ui"), {
            requiredPackages: [{ name: "@politty-test/missing-ui" }],
          }),
        }),
      ]),
      run: (args) => args.mode,
    });
    expect((await runCommand(command, ["--mode", "tests"])).result).toBe("tests");
    const enabled = await runCommand(command, ["--mode", "ui"]);
    expect(enabled.success).toBe(false);
    expect(enabled.error?.message).toContain('Package "@politty-test/missing-ui" is required.');
    const output: string[] = [];
    const help = await runCommand(command, ["--help"], {
      logger: { log: (text) => output.push(text), error: () => {} },
    });
    expect(help.success).toBe(true);
    expect(output.join("\n")).toContain("@politty-test/missing-ui");
    output.length = 0;
    await runCommand(command, ["--help-json"], {
      logger: { log: (text) => output.push(text), error: () => {} },
    });
    const data = JSON.parse(output[0]!);
    expect(
      data.variants.find(
        (variant: { discriminatorValue: string }) => variant.discriminatorValue === "ui",
      ).requiredPackages[0].name,
    ).toBe("@politty-test/missing-ui");
    expect(
      data.options.find((field: { name: string }) => field.name === "mode").requiredPackages,
    ).toBeUndefined();
  });

  it("loads global discriminator packages for commands with local schemas", async () => {
    const command = defineCommand({
      name: "test",
      args: z.object({ file: z.string().default("data") }),
      run: () => "tests",
    });
    const globalArgs = z.discriminatedUnion("mode", [
      z.object({ mode: z.literal("tests") }),
      z.object({
        mode: arg(z.literal("ui"), { requiredPackages: [{ name: "@politty-test/missing-ui" }] }),
      }),
    ]);
    expect((await runCommand(command, ["--mode", "tests"], { globalArgs })).result).toBe("tests");
    const result = await runCommand(command, ["--mode", "ui"], { globalArgs });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("@politty-test/missing-ui");
  });

  it("keeps different boolean package requirements in their help variants", async () => {
    const command = defineCommand({
      name: "test",
      args: z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("a"),
          ui: arg(z.boolean(), { requiredPackages: [{ name: "@politty-test/a" }] }),
        }),
        z.object({
          mode: z.literal("b"),
          ui: arg(z.boolean(), { requiredPackages: [{ name: "@politty-test/b" }] }),
        }),
      ]),
      run: () => {},
    });
    const output: string[] = [];
    const logger = { log: (text: string) => output.push(text), error: () => {} };
    await runCommand(command, ["--help"], { logger });
    expect(output.join("\n")).toContain("@politty-test/a");
    expect(output.join("\n")).toContain("@politty-test/b");
    output.length = 0;
    await runCommand(command, ["--help-json"], { logger });
    const data = JSON.parse(output[0]!);
    expect(data.options.some((field: { name: string }) => field.name === "ui")).toBe(false);
    expect(data.variants[0].fields[0].requiredPackages[0].name).toBe("@politty-test/a");
    expect(data.variants[1].fields[0].requiredPackages[0].name).toBe("@politty-test/b");
  });

  it("shows positional boolean package requirements in text help", async () => {
    const command = defineCommand({
      name: "test",
      args: z.object({
        ui: arg(z.boolean(), {
          positional: true,
          requiredPackages: [{ name: "@politty-test/missing-ui" }],
        }),
      }),
      run: () => {},
    });
    const output: string[] = [];
    await runCommand(command, ["--help"], {
      logger: { log: (text) => output.push(text), error: () => {} },
    });
    expect(output.join("\n")).toContain("@politty-test/missing-ui");
  });

  it("preserves global package requirements when a local field has the same name", async () => {
    const command = defineCommand({
      name: "test",
      args: z.object({ ui: z.boolean().default(false) }),
      run: () => "tests",
    });
    const globalArgs = z.object({
      ui: arg(z.boolean().default(false), {
        requiredPackages: [{ name: "@politty-test/missing-ui" }],
      }),
    });
    expect((await runCommand(command, [], { globalArgs })).result).toBe("tests");
    const result = await runCommand(command, ["--ui"], { globalArgs });
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("@politty-test/missing-ui");
  });

  it("only requires the UI package when --ui is enabled", async () => {
    const command = defineCommand({
      name: "vitest",
      args: z.object({ ui: arg(z.boolean().default(false)) }),
      requiredPackages: [
        {
          name: "@politty-test/missing-ui",
          install: "npm install -D @politty-test/missing-ui",
          description: "--ui",
          when: (args) => args.ui,
        },
      ],
      run: (args) => (args.ui ? "ui" : "tests"),
    });
    expect((await runCommand(command, [])).result).toBe("tests");
    expect((await runCommand(command, ["--no-ui"])).success).toBe(true);
    const result = await runCommand(command, ["--ui"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("npm install -D @politty-test/missing-ui");
    const output: string[] = [];
    expect(
      (
        await runCommand(command, ["--ui", "--help"], {
          logger: { log: (text) => output.push(text), error: () => {} },
        })
      ).success,
    ).toBe(true);
    expect(output.join("\n")).toContain("--ui: Requires @politty-test/missing-ui");
  });

  it("loads import-only exports from the consuming project", async () => {
    const requirement = await fixture("export const start = () => 'studio';", {
      import: "./index.js",
    });
    const command = defineCommand({
      name: "studio",
      requiredPackages: [requirement],
      run: async () => (await loadPackage<{ start: () => string }>(requirement)).start(),
    });
    expect((await runCommand(command, [])).result).toBe("studio");
  });

  it.each([
    ["import '@politty-test/missing-transitive';", "@politty-test/missing-transitive"],
    ["throw new Error('studio initialization failed');", "studio initialization failed"],
  ])("preserves package errors for %s", async (source, message) => {
    const requirement = await fixture(source);
    const command = defineCommand({
      name: "studio",
      requiredPackages: [requirement],
      run: () => "unexpected",
    });
    const original = await loadPackage(requirement).catch((error: unknown) => error);
    const result = await runCommand(command, []);
    expect(result.success).toBe(false);
    expect(result.error).toBe(original);
    expect(result.error?.message).toContain(message);
    expect(result.error?.message).not.toContain("Install it with");
  });

  it("preserves broken package entry point errors", async () => {
    const requirement = await fixture("", "./missing.js");
    await expect(loadPackage(requirement)).rejects.toThrow("missing.js");
    await expect(loadPackage(requirement)).rejects.not.toThrow("Install it with");
  });

  it("keeps unrelated commands and root help available without the package", async () => {
    const requirement: PackageRequirement = {
      name: "@politty-test/missing-studio",
      install: "npm install -D @politty-test/missing-studio",
    };
    const command = defineCommand({
      name: "lines-db",
      subCommands: {
        validate: defineCommand({ name: "validate", run: () => "valid" }),
        studio: defineCommand({
          name: "studio",
          requiredPackages: [requirement],
          run: () => "studio",
        }),
      },
    });
    expect((await runCommand(command, ["validate"])).result).toBe("valid");
    expect((await runCommand(command, ["studio"])).success).toBe(false);
    const output: string[] = [];
    await runCommand(command, ["--help"], {
      logger: { log: (text) => output.push(text), error: () => {} },
    });
    expect(output.join("\n")).toContain(requirement.install);
    const json: string[] = [];
    await runCommand(command, ["studio", "--help-json"], {
      logger: { log: (text) => json.push(text), error: () => {} },
    });
    expect(JSON.parse(json[0]!).requiredPackages[0].name).toBe(requirement.name);
  });

  it.each(["--help", "--help-all", "--help-json"])(
    "shows lazy command %s without loading its required package",
    async (help) => {
      let loads = 0;
      const requirement = {
        name: "@politty-test/missing-studio",
        install: "npm install -D @politty-test/missing-studio",
      };
      const command = defineCommand({
        name: "lines-db",
        subCommands: {
          studio: lazy(
            defineCommand({ name: "studio", requiredPackages: [requirement] }),
            async () => {
              loads++;
              return loadPackage(requirement);
            },
          ),
        },
      });
      const output: string[] = [];
      const result = await runCommand(command, ["studio", help], {
        logger: { log: (text) => output.push(text), error: () => {} },
      });
      expect(result.success).toBe(true);
      expect(loads).toBe(0);
      expect(output.join("\n")).toContain(requirement.install);
      expect((await runCommand(command, ["studio"])).error?.message).toContain(requirement.install);
      expect(loads).toBe(0);
    },
  );
});

describe("installed optional packages", () => {
  it("executes an enabled UI option with an installed package", async () => {
    const requirement = await fixture("export const start = () => 'ui started';");
    const command = defineCommand({
      name: "vitest",
      args: z.object({ ui: arg(z.boolean().default(false), { alias: "u" }) }),
      requiredPackages: [{ ...requirement, description: "--ui", when: (args) => args.ui }],
      run: async (args) =>
        args.ui ? (await loadPackage<{ start: () => string }>(requirement)).start() : "tests",
    });
    expect((await runCommand(command, ["-u"])).result).toBe("ui started");
  });

  it("loads a required lazy subcommand from a consuming project", async () => {
    const requirement = await fixture(
      "export const command = { name: 'studio', args: undefined, run: () => 'studio started' };",
    );
    const command = defineCommand({
      name: "lines-db",
      subCommands: {
        studio: lazy(
          defineCommand({ name: "studio", aliases: ["s"], requiredPackages: [requirement] }),
          async () => (await loadPackage<{ command: AnyCommand }>(requirement)).command,
        ),
      },
    });
    expect((await runCommand(command, ["s"])).result).toBe("studio started");
  });
});

describe("nested lazy requirements", () => {
  it("executes a lazy group whose run hook is supplied only by the loader", async () => {
    const requirement = await fixture("export const ready = true;");
    const view = defineCommand({ name: "view" });
    const meta = defineCommand({
      name: "studio",
      requiredPackages: [requirement],
      subCommands: { view },
    });
    const command = defineCommand({
      name: "lines-db",
      subCommands: {
        studio: lazy(meta, async () =>
          defineCommand({
            name: "studio",
            subCommands: { view },
            run: () => "studio started",
          }),
        ),
      },
    });
    expect((await runCommand(command, ["studio"])).result).toBe("studio started");
  });

  it("shows nested help from synchronous metadata without loading the parent package", async () => {
    let loads = 0;
    const leaf = defineCommand({ name: "view", aliases: ["v"], description: "View data" });
    const requirement = {
      name: "@politty-test/missing-studio",
      install: "npm install -D @politty-test/missing-studio",
    };
    const command = defineCommand({
      name: "lines-db",
      subCommands: {
        studio: lazy(
          defineCommand({
            name: "studio",
            requiredPackages: [requirement],
            subCommands: {
              view: lazy(leaf, async () => {
                loads++;
                throw new Error("child loader must not run during help");
              }),
            },
          }),
          async () => {
            loads++;
            return loadPackage(requirement);
          },
        ),
      },
    });
    const output: string[] = [];
    const result = await runCommand(command, ["studio", "v", "--help"], {
      logger: { log: (text) => output.push(text), error: () => {} },
    });
    expect(result.success).toBe(true);
    expect(loads).toBe(0);
    expect(output.join("\n")).toContain("View data");
  });
});

describe("automatic installation guidance", () => {
  it("detects pnpm when install is omitted", async () => {
    const installed = await fixture("");
    const directory = dirname(fileURLToPath(installed.from));
    await writeFile(join(directory, "pnpm-lock.yaml"), "");
    const requirement = { name: "@politty-test/missing-studio", from: installed.from };
    const command = defineCommand({
      name: "studio",
      requiredPackages: [requirement],
      run: () => "unexpected",
    });
    const result = await runCommand(command, []);
    expect(result.error?.message).toContain("pnpm add -D @politty-test/missing-studio");
    const output: string[] = [];
    await runCommand(command, ["--help"], {
      logger: { log: (value) => output.push(value), error: () => {} },
    });
    expect(output.join("\n")).toContain("pnpm add -D @politty-test/missing-studio");
  });
});

describe("project package managers", () => {
  it.each([
    ["package-lock.json", "npm install"],
    ["npm-shrinkwrap.json", "npm install"],
    ["pnpm-lock.yaml", "pnpm add"],
    ["yarn.lock", "yarn add"],
    ["bun.lock", "bun add"],
    ["bun.lockb", "bun add"],
  ])("uses %s for error and JSON help guidance", async (filename, command) => {
    const installed = await fixture("");
    const directory = dirname(fileURLToPath(installed.from));
    await writeFile(join(directory, filename), "");
    const requirement = { name: "@politty-test/missing-studio", from: installed.from };
    const cli = defineCommand({ name: "studio", requiredPackages: [requirement], run: () => {} });
    const result = await runCommand(cli, []);
    expect(result.error?.message).toContain(`${command} -D @politty-test/missing-studio`);
    const output: string[] = [];
    await runCommand(cli, ["--help-json"], {
      logger: { log: (value) => output.push(value), error: () => {} },
    });
    expect(JSON.parse(output[0]!).requiredPackages[0].install).toBe(
      `${command} -D @politty-test/missing-studio`,
    );
  });

  it("prefers the packageManager declaration and searches parent projects", async () => {
    const installed = await fixture("");
    const directory = dirname(fileURLToPath(installed.from));
    await writeFile(
      join(directory, "package.json"),
      JSON.stringify({ packageManager: "yarn@4.6.0" }),
    );
    await writeFile(join(directory, "pnpm-lock.yaml"), "");
    const nested = join(directory, "apps", "frontend");
    await mkdir(nested, { recursive: true });
    const requirement = {
      name: "@politty-test/missing-studio",
      from: pathToFileURL(join(nested, "cli.js")),
    };
    await expect(loadPackage(requirement)).rejects.toThrow(
      "yarn add -D @politty-test/missing-studio",
    );
  });

  it("keeps an explicit installation command even when a manager is detected", async () => {
    const installed = await fixture("");
    const directory = dirname(fileURLToPath(installed.from));
    await writeFile(join(directory, "bun.lock"), "");
    await expect(
      loadPackage({
        name: "@politty-test/missing-studio",
        from: installed.from,
        install: "pnpm add -D @politty-test/missing-studio@2",
      }),
    ).rejects.toThrow("pnpm add -D @politty-test/missing-studio@2");
  });

  it("falls back to npm without project metadata", async () => {
    const installed = await fixture("");
    await expect(
      loadPackage({ name: "@politty-test/missing-studio", from: installed.from }),
    ).rejects.toThrow("npm install -D @politty-test/missing-studio");
  });
});
