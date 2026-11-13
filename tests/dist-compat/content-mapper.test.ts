/**
 * End-to-end tests of the content mapper the built packages ship: a real
 * `tsc` (TypeScript 7.1) and a real `tsrs` type-check a project whose
 * commands read global options typed only by the `runMain` call.
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
const coreModules = path.join(rootDir, "packages/core/node_modules");

const COMPILERS = {
  typescript: "typescript/bin/tsc",
  tsrs: "tsrs/bin/tsrs",
} as const;

const PACKAGES = {
  "@politty/zod": { dir: "packages/zod", schemaLibrary: "zod" },
  politty: { dir: "packages/politty", schemaLibrary: "zod" },
  "@politty/valibot": { dir: "packages/valibot", schemaLibrary: "valibot" },
} as const;

type PackageName = keyof typeof PACKAGES;

const GLOBAL_ARGS: Record<string, string> = {
  zod: `z.object({ verbose: z.boolean().default(false), profile: z.string().optional() })`,
  valibot: `v.object({ verbose: v.optional(v.boolean(), false), profile: v.optional(v.string()) })`,
};

const SCHEMA_IMPORT: Record<string, string> = {
  zod: `import { z } from "zod";`,
  valibot: `import * as v from "valibot";`,
};

const fixtures: string[] = [];

afterEach(() => {
  for (const dir of fixtures.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function link(dir: string, name: string, target: string): void {
  const linkPath = path.join(dir, "node_modules", name);
  fs.mkdirSync(path.dirname(linkPath), { recursive: true });
  fs.symlinkSync(fs.realpathSync(target), linkPath, "dir");
}

function write(dir: string, relative: string, content: string): void {
  const file = path.join(dir, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

function createProject(
  packageName: PackageName,
  options: Record<string, unknown> | undefined,
  verboseType = "boolean",
): string {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "politty-content-mapper-")));
  fixtures.push(dir);
  const { dir: packageDir, schemaLibrary } = PACKAGES[packageName];
  link(dir, packageName, path.join(rootDir, packageDir));
  link(dir, schemaLibrary, path.join(rootDir, packageDir, "node_modules", schemaLibrary));
  for (const compiler of Object.keys(COMPILERS)) {
    link(dir, compiler, path.join(coreModules, compiler));
  }
  write(
    dir,
    "tsconfig.json",
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
        types: [],
        noUnusedLocals: true,
        verbatimModuleSyntax: true,
      },
      include: ["src/**/*.ts"],
      contentMappers: [
        { package: packageName, extensions: [".politty"], ...(options && { options }) },
      ],
    }),
  );
  write(
    dir,
    "src/main.ts",
    `${SCHEMA_IMPORT[schemaLibrary]}
import { defineCommand, runMain } from "${packageName}";
import { build } from "./commands/build.js";

const cli = defineCommand({ name: "app", subCommands: { build } });
void runMain(cli, { globalArgs: ${GLOBAL_ARGS[schemaLibrary]} });
`,
  );
  write(
    dir,
    "src/commands/build.ts",
    `import { defineCommand } from "${packageName}";

export const build = defineCommand({
  name: "build",
  run: (args) => {
    const verbose: ${verboseType} = args.verbose;
    const profile: string | undefined = args.profile;
    return [verbose, profile];
  },
});
`,
  );
  return dir;
}

function typeCheck(compiler: keyof typeof COMPILERS, dir: string) {
  const result = spawnSync(
    process.execPath,
    [path.join(dir, "node_modules", COMPILERS[compiler]), "-p", dir, "--runExternalCode"],
    { cwd: dir, encoding: "utf8", timeout: 60_000 },
  );
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

describe.each(Object.keys(COMPILERS) as (keyof typeof COMPILERS)[])(
  "content mapper under %s",
  (compiler) => {
    it.each(Object.keys(PACKAGES) as PackageName[])(
      "types the global options of %s from runMain",
      (packageName) => {
        const ok = typeCheck(compiler, createProject(packageName, { entry: "./src/main.ts" }));
        expect(ok).toEqual({ status: 0, output: "" });

        const wrong = typeCheck(
          compiler,
          createProject(packageName, { entry: "./src/main.ts" }, "string"),
        );
        expect(wrong.status).not.toBe(0);
        expect(wrong.output).toContain("src/commands/build.ts");
        expect(wrong.output).toMatch(/Type 'boolean' is not assignable to type 'string'/);
      },
    );

    it("reads the entry with the API package named by the compiler option", () => {
      const other = compiler === "typescript" ? "tsrs" : "typescript";
      const dir = createProject("@politty/zod", { entry: "./src/main.ts", compiler: other });
      expect(typeCheck(compiler, dir)).toEqual({ status: 0, output: "" });
    });

    it("reports a missing entry option", () => {
      const result = typeCheck(compiler, createProject("@politty/zod", undefined));
      expect(result.status).not.toBe(0);
      expect(result.output).toContain(`global-args.politty`);
      expect(result.output).toContain(`needs the "entry" option`);
    });
  },
);
