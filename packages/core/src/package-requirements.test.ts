import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
      requires: [
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
  it("only requires the UI package when --ui is enabled", async () => {
    const command = defineCommand({
      name: "vitest",
      args: z.object({ ui: arg(z.boolean().default(false)) }),
      requires: [
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
      requires: [requirement],
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
      requires: [requirement],
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
        studio: defineCommand({ name: "studio", requires: [requirement], run: () => "studio" }),
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
    expect(JSON.parse(json[0]!).requires[0].name).toBe(requirement.name);
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
          studio: lazy(defineCommand({ name: "studio", requires: [requirement] }), async () => {
            loads++;
            return loadPackage(requirement);
          }),
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
      requires: [{ ...requirement, description: "--ui", when: (args) => args.ui }],
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
          defineCommand({ name: "studio", aliases: ["s"], requires: [requirement] }),
          async () => (await loadPackage<{ command: AnyCommand }>(requirement)).command,
        ),
      },
    });
    expect((await runCommand(command, ["s"])).result).toBe("studio started");
  });
});

describe("nested lazy requirements", () => {
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
          defineCommand({ name: "studio", requires: [requirement], subCommands: { view: leaf } }),
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
