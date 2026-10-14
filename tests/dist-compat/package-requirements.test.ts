import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("published package requirements", () => {
  it.each(["politty", "zod", "zod-mini", "valibot"])(
    "%s supports packages attached to boolean options",
    async (adapter) => {
      const { arg, defineCommand, runCommand } = await import(
        pathToFileURL(join(root, "packages", adapter, "dist", "index.js")).href
      );
      const metadata = { requiredPackages: [{ name: "@politty-test/missing-ui" }] };
      let args;
      if (adapter === "valibot") {
        const v = await import("valibot");
        args = v.object({ ui: arg(v.optional(v.boolean(), false), metadata) });
      } else if (adapter === "zod-mini") {
        const z = await import("zod/mini");
        args = z.object({ ui: arg(z._default(z.boolean(), false), metadata) });
      } else {
        const { z } = await import("zod");
        args = z.object({ ui: arg(z.boolean().default(false), metadata) });
      }
      const command = defineCommand({ name: "test", args, run: () => "tests" });
      expect((await runCommand(command, [])).result).toBe("tests");
      const enabled = await runCommand(command, ["--ui"]);
      expect(enabled.success).toBe(false);
      expect(enabled.error?.message).toContain('Package "@politty-test/missing-ui" is required.');
    },
  );

  it.each(["politty", "zod", "zod-mini", "valibot"])(
    "%s resolves optional packages from the consuming working directory",
    (adapter) => {
      const directory = mkdtempSync(join(tmpdir(), "politty-consumer-"));
      try {
        const dependency = join(directory, "node_modules", "@politty-test", "studio");
        mkdirSync(dependency, { recursive: true });
        writeFileSync(
          join(dependency, "package.json"),
          JSON.stringify({
            name: "@politty-test/studio",
            type: "module",
            exports: { import: "./index.js" },
          }),
        );
        writeFileSync(join(directory, "pnpm-lock.yaml"), "");
        writeFileSync(join(dependency, "index.js"), "export const start = () => 'studio started';");
        const entry = pathToFileURL(join(root, "packages", adapter, "dist", "index.js")).href;
        const script = `
          import { defineCommand, loadPackage, runMain } from ${JSON.stringify(entry)};
          const requirement = { name: '@politty-test/studio', install: 'npm install -D @politty-test/studio' };
          const command = defineCommand({ name: 'lines-db', subCommands: {
            studio: defineCommand({ name: 'studio', requiredPackages: [requirement], run: async () => {
              console.log((await loadPackage(requirement)).start());
            } }),
            missing: defineCommand({ name: 'missing', requiredPackages: [{ name: '@politty-test/missing' }], run: () => {} }),
          } });
          await runMain(command, { compileCache: false });
        `;
        const cli = join(directory, "cli.mjs");
        writeFileSync(cli, script);
        const output = execFileSync(process.execPath, [cli, "studio"], {
          cwd: directory,
          encoding: "utf8",
        });
        expect(output).toContain("studio started");
        const help = execFileSync(process.execPath, [cli, "--help"], {
          cwd: directory,
          encoding: "utf8",
        });
        expect(help).toContain("pnpm add -D @politty-test/missing");
        let failure: { status?: number; stderr?: string } | undefined;
        try {
          execFileSync(process.execPath, [cli, "missing"], {
            cwd: directory,
            encoding: "utf8",
            stdio: "pipe",
          });
        } catch (error) {
          failure = error as { status?: number; stderr?: string };
        }
        expect(failure?.status).toBe(1);
        expect(failure?.stderr).toContain("pnpm add -D @politty-test/missing");
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
