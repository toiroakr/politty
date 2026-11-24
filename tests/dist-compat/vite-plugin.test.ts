/**
 * End-to-end test of the Vite plugin the built packages ship: a real Vitest
 * run in a project whose test calls `runCommand(subcommand, argv)` without
 * importing the global args, `setup` or `cleanup` that its CLI entry passes
 * to `runMain`.
 *
 * The dist is built once for the whole project in `global-setup.ts`.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const vitestBin = path.join(
  fs.realpathSync(path.join(rootDir, "node_modules/vitest")),
  "vitest.mjs",
);

const PACKAGES = {
  "@politty/zod": { dir: "packages/zod", schemaLibrary: "zod", schemas: "zod" },
  politty: { dir: "packages/politty", schemaLibrary: "zod", schemas: "zod" },
  "@politty/valibot": { dir: "packages/valibot", schemaLibrary: "valibot", schemas: "valibot" },
  "@politty/zod-mini": { dir: "packages/zod-mini", schemaLibrary: "zod", schemas: "zod-mini" },
} as const;

const SCHEMA_IMPORT: Record<string, string> = {
  zod: `import { z } from "zod";`,
  valibot: `import * as v from "valibot";`,
  "zod-mini": `import * as z from "zod/mini";`,
};

const SCHEMAS: Record<string, { positional: string; globalArgs: string }> = {
  zod: {
    positional: `z.object({ target: arg(z.string(), { positional: true }) })`,
    globalArgs: `z.object({ verbose: arg(z.boolean().default(false)) })`,
  },
  valibot: {
    positional: `v.object({ target: arg(v.string(), { positional: true }) })`,
    globalArgs: `v.object({ verbose: arg(v.optional(v.boolean(), false)) })`,
  },
  "zod-mini": {
    positional: `z.object({ target: arg(z.string(), { positional: true }) })`,
    globalArgs: `z.object({ verbose: arg(z._default(z.boolean(), false)) })`,
  },
};

const fixtures: string[] = [];

afterEach(async () => {
  for (const dir of fixtures.splice(0)) {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 5 });
  }
});

function link(dir: string, name: string, target: string): void {
  const linkPath = path.join(dir, "node_modules", name);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(fs.realpathSync(target), linkPath, "junction");
}

function write(dir: string, relative: string, content: string): void {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function createProject(
  packageName: keyof typeof PACKAGES,
  testBody: string,
  { withPlugin = true, shareModules = false } = {},
): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "politty-vite-plugin-")));
  fixtures.push(dir);
  const { dir: packageDir, schemaLibrary, schemas } = PACKAGES[packageName];
  link(dir, packageName, path.join(rootDir, packageDir));
  link(dir, schemaLibrary, path.join(rootDir, packageDir, "node_modules", schemaLibrary));
  link(dir, "vitest", path.join(rootDir, "node_modules/vitest"));
  write(
    dir,
    "tsconfig.json",
    JSON.stringify({
      contentMappers: [{ package: packageName, options: { entry: "./src/cli.ts" } }],
    }),
  );
  write(
    dir,
    "vitest.config.ts",
    `import { defineConfig } from "vitest/config";
${withPlugin ? `import { politty } from "${packageName}/vite";\n` : ""}
export default defineConfig({ plugins: [${withPlugin ? "politty()" : ""}], test: { include: ["src/**/*.test.ts"], isolate: ${!shareModules}, fileParallelism: false } });
`,
  );
  write(
    dir,
    "src/deploy.ts",
    `import { arg, defineCommand } from "${packageName}";
${SCHEMA_IMPORT[schemas]}

export const deploy = defineCommand({
  name: "deploy",
  args: ${SCHEMAS[schemas]!.positional},
  run: (args) => ({ target: args.target, verbose: args.verbose }),
});
`,
  );
  write(
    dir,
    "src/cli.ts",
    `import { arg, defineCommand, runMain } from "${packageName}";
${SCHEMA_IMPORT[schemas]}
import { deploy } from "./deploy.js";

const globalArgs = ${SCHEMAS[schemas]!.globalArgs};

const cli = defineCommand({
  name: "mycli",
  subCommands: { ops: defineCommand({ name: "ops", subCommands: { deploy } }) },
});

await runMain(cli, {
  globalArgs,
  setup: () => {
    globalThis.__events = ["setup"];
  },
  cleanup: () => {
    globalThis.__events.push("cleanup");
  },
});
`,
  );
  write(dir, "src/deploy.test.ts", testSource(packageName, testBody));
  if (shareModules) write(dir, "src/second.test.ts", testSource(packageName, testBody));
  return dir;
}

function testSource(packageName: string, testBody: string): string {
  return `import { expect, it } from "vitest";
import { runCommand } from "${packageName}";
import { deploy } from "./deploy.js";

${testBody}
`;
}

function runVitest(dir: string): { status: number | null; output: string } {
  const result = spawnSync(process.execPath, [vitestBin, "run"], {
    cwd: dir,
    encoding: "utf8",
    timeout: 120_000,
    env: {
      ...process.env,
      POLITTY_NO_AGENT: "1",
      XDG_CACHE_HOME: path.join(dir, ".cache"),
      CI: "1",
      NO_COLOR: "1",
    },
  });
  if (result.error) throw result.error;
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe.each(Object.keys(PACKAGES) as (keyof typeof PACKAGES)[])("%s/vite", (packageName) => {
  it("runs a subcommand with the global args, setup and cleanup of the CLI entry", () => {
    const dir = createProject(
      packageName,
      `it("applies the CLI's global options without importing them", async () => {
  const result = await runCommand(deploy, ["--verbose", "prod"]);

  expect(result).toMatchObject({ success: true, result: { target: "prod", verbose: true } });
  expect(globalThis.__events).toEqual(["setup", "cleanup"]);
});`,
    );

    const { status, output } = runVitest(dir);

    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });

  it("runs the same test without the CLI options when the plugin is not installed", () => {
    const dir = createProject(
      packageName,
      `it("needs the plugin", async () => {
  const result = await runCommand(deploy, ["--verbose", "prod"]);

  expect(result.success).toBe(false);
  expect(globalThis.__events).toBeUndefined();
});`,
      { withPlugin: false },
    );

    const { status, output } = runVitest(dir);

    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });

  it("loads the entry before the tests of the file run", () => {
    const dir = createProject(
      packageName,
      `it("has the entry loaded before the first runCommand call", async () => {
  const loadedBefore = (globalThis as Record<string, unknown>)["__entry_loaded"];

  await runCommand(deploy, ["prod"]);

  expect(loadedBefore).toBe(true);
});`,
    );
    const entry = fs.readFileSync(path.join(dir, "src/cli.ts"), "utf8");
    write(dir, "src/cli.ts", `globalThis.__entry_loaded = true;\n${entry}`);

    const { status, output } = runVitest(dir);

    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });

  it("keeps the mocks of the test file for the modules that the entry imports", () => {
    const dir = createProject(
      packageName,
      `import { vi } from "vitest";

vi.mock("./client.js", () => ({ client: { call: () => "mocked" } }));

it("uses the mocked client", async () => {
  const result = await runCommand(deploy, ["--verbose", "prod"]);

  expect(result).toMatchObject({ success: true, result: { via: "mocked", verbose: true } });
});`,
    );
    const { schemas } = PACKAGES[packageName];
    write(dir, "src/client.ts", `export const client = { call: () => "real" };\n`);
    write(
      dir,
      "src/deploy.ts",
      `import { arg, defineCommand } from "${packageName}";
${SCHEMA_IMPORT[schemas]}
import { client } from "./client.js";

export const deploy = defineCommand({
  name: "deploy",
  args: ${SCHEMAS[schemas]!.positional},
  run: (args) => ({ target: args.target, verbose: args.verbose, via: client.call() }),
});
`,
    );

    const { status, output } = runVitest(dir);

    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });

  it("applies the CLI options in every test file when the files share modules", () => {
    const dir = createProject(
      packageName,
      `it("applies the CLI's global options", async () => {
  const result = await runCommand(deploy, ["--verbose", "prod"]);

  expect(result).toMatchObject({ success: true, result: { target: "prod", verbose: true } });
});`,
      { shareModules: true },
    );

    const { status, output } = runVitest(dir);

    expect(output).toContain("2 passed");
    expect(status).toBe(0);
  });

  it("keeps a test that passes its own options working", () => {
    const dir = createProject(
      packageName,
      `it("prefers the options of the test", async () => {
  const result = await runCommand(deploy, ["prod"], { setup: undefined, cleanup: undefined });

  expect(result).toMatchObject({ success: true, result: { target: "prod", verbose: false } });
  expect(globalThis.__events).toBeUndefined();
});`,
    );

    const { status, output } = runVitest(dir);

    expect(output).toContain("1 passed");
    expect(status).toBe(0);
  });
});

describe("two politty packages in one project", () => {
  it("rejects the second plugin even though each package bundles its own copy of the plugin", () => {
    const dir = createProject("@politty/zod", `it("never runs", () => {});`);
    link(dir, "@politty/valibot", path.join(rootDir, "packages/valibot"));
    write(
      dir,
      "vitest.config.ts",
      `import { defineConfig } from "vitest/config";
import { politty as zod } from "@politty/zod/vite";
import { politty as valibot } from "@politty/valibot/vite";

export default defineConfig({
  plugins: [zod({ entry: "./src/cli.ts" }), valibot({ entry: "./src/other.ts" })],
  test: { include: ["src/**/*.test.ts"] },
});
`,
    );

    const { status, output } = runVitest(dir);

    expect(output).toContain("registered more than once");
    expect(status).not.toBe(0);
  });
});
