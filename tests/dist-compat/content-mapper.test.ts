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
  "@politty/zod": { dir: "packages/zod", schemaLibrary: "zod", schemas: "zod" },
  politty: { dir: "packages/politty", schemaLibrary: "zod", schemas: "zod" },
  "@politty/valibot": { dir: "packages/valibot", schemaLibrary: "valibot", schemas: "valibot" },
  "@politty/zod-mini": { dir: "packages/zod-mini", schemaLibrary: "zod", schemas: "zod-mini" },
} as const;

type PackageName = keyof typeof PACKAGES;

const GLOBAL_ARGS: Record<string, string> = {
  zod: `z.object({ verbose: arg(z.boolean().default(false), { alias: "v" }), profile: z.string().optional() })`,
  valibot: `v.object({ verbose: arg(v.optional(v.boolean(), false), { alias: "v" }), profile: v.optional(v.string()) })`,
  "zod-mini": `z.object({ verbose: arg(z._default(z.boolean(), false), { alias: "v" }), profile: z.optional(z.string()) })`,
};

const SCHEMA_IMPORT: Record<string, string> = {
  zod: `import { z } from "zod";`,
  valibot: `import * as v from "valibot";`,
  "zod-mini": `import * as z from "zod/mini";`,
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
  const { dir: packageDir, schemaLibrary, schemas } = PACKAGES[packageName];
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
    `${SCHEMA_IMPORT[schemas]}
import { arg, defineCommand, runMain } from "${packageName}";
import { build } from "./commands/build.js";

const cli = defineCommand({ name: "app", subCommands: { build } });
void runMain(cli, { globalArgs: ${GLOBAL_ARGS[schemas]} });
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

    it("types a union of global option shapes as one object", () => {
      const dir = createProject("@politty/zod", { entry: "./src/main.ts" });
      write(
        dir,
        "src/main.ts",
        `import { z } from "zod";
import { defineCommand, runMain } from "@politty/zod";
import { build } from "./commands/build.js";

const cli = defineCommand({ name: "app", subCommands: { build } });
void runMain(cli, {
  globalArgs: z.discriminatedUnion("mode", [
    z.object({ mode: z.literal("local"), path: z.string(), profile: z.string().optional() }),
    z.object({ mode: z.literal("remote"), url: z.string(), profile: z.string().optional() }),
  ]),
});
`,
      );
      write(
        dir,
        "src/commands/build.ts",
        `import { defineCommand } from "@politty/zod";

export const build = defineCommand({
  name: "build",
  run: (args) => {
    const mode: "local" | "remote" = args.mode;
    const location: string | undefined = args.path ?? args.url;
    const profileIsOptional: {} extends Pick<typeof args, "profile"> ? true : false = true;
    const modeIsRequired: {} extends Pick<typeof args, "mode"> ? false : true = true;
    return [mode, location, profileIsOptional, modeIsRequired];
  },
});
`,
      );
      expect(typeCheck(compiler, dir)).toEqual({ status: 0, output: "" });
    });

    it("copies a partly used destructuring without unused locals", () => {
      const dir = createProject("@politty/zod", { entry: "./src/main.ts" });
      write(
        dir,
        "src/main.ts",
        `import { z } from "zod";
import { defineCommand, runMain } from "@politty/zod";
import { build } from "./commands/build.js";

const { object, boolean, string } = z;
const cli = defineCommand({
  name: "app",
  args: object({ name: string().optional() }),
  subCommands: { build },
});
void runMain(cli, {
  globalArgs: object({ verbose: boolean().default(false), profile: z.string().optional() }),
});
`,
      );
      expect(typeCheck(compiler, dir)).toEqual({ status: 0, output: "" });
    });

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
