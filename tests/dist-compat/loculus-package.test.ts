import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as l from "../../packages/loculus/node_modules/loculus/dist/index.js";
import type * as LoculusPolitty from "../../packages/loculus/src/index.js";

const packageDir = resolve("packages/loculus");
const dist = resolve(packageDir, "dist");

describe("@politty/loculus published output", () => {
  it("runs commands from built output", async () => {
    const { defineCommand, runCommand } = (await import(
      `${dist}/index.js`
    )) as typeof LoculusPolitty;
    const cmd = defineCommand({
      name: "serve",
      args: l.object({
        name: l.string(),
        port: l.number({ gte: 1, default: 3000 }),
        cache: l.boolean({ default: { nullish: true } }),
      }),
      run: (args) => `${args.name}:${args.port}:${args.cache}`,
    });
    expect((await runCommand(cmd, ["--name", "app", "--port", "8080"])).result).toBe(
      "app:8080:true",
    );
    expect((await runCommand(cmd, ["--name", "app", "--port", "0"])).success).toBe(false);
  });
  it("loads the public subpaths and CLI", async () => {
    for (const entry of ["docs", "completion", "skill", "prompt", "agent", "compile-cache"]) {
      const mod = await import(`${dist}/${entry}.js`);
      expect(Object.keys(mod).length).toBeGreaterThan(0);
    }
    const help = execFileSync(process.execPath, [resolve(packageDir, "bin/cli.mjs"), "--help"], {
      encoding: "utf8",
    });
    expect(help).toContain("Usage:");
  });
  it("preserves GlobalArgs augmentation in built declarations", () => {
    const compiler = resolve("node_modules/.bin/tsgo");
    execFileSync(compiler, ["-p", "tests/dist-compat/fixtures/loculus-global-args-merge"], {
      stdio: "pipe",
    });
    expect(() =>
      execFileSync(
        compiler,
        ["-p", "tests/dist-compat/fixtures/loculus-global-args-merge-negative"],
        { stdio: "pipe" },
      ),
    ).toThrow();
  });
  it("ships no Zod or Valibot runtime", () => {
    const files = readdirSync(dist).filter((name) => name.endsWith(".js"));
    expect(files.length).toBeGreaterThan(0);
    for (const name of files) {
      const source = readFileSync(resolve(dist, name), "utf8");
      expect(source).not.toMatch(
        /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)['"](?:zod|valibot)(?:\/[^'"]+)?['"]/,
      );
      expect(source).not.toMatch(/\$Zod[A-Z]|\b_zod\b/);
    }
  });
});
