import { loculusPlugin } from "@loculus/rolldown";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { rolldown } from "rolldown";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

type Probe = {
  outcomes: Array<{ argv?: string[]; success: boolean; result?: unknown; error?: string }>;
  prompted: Record<string, unknown>;
  promptRun: { success: boolean; result?: unknown };
  help: Record<string, { plain: string; json: unknown }>;
  table: string;
  completions: Record<string, string>;
  doc: string;
  templateDoc: string;
  docSuccess: boolean;
};
type BuildResult = {
  probe: Probe;
  executions: Array<{ argv: string[]; status: number | null; stdout: string; stderr: string }>;
  transformed: boolean;
};
const fixture = resolve("tests/dist-compat/fixtures/loculus-rolldown/cli.mjs");
const dist = resolve("packages/loculus/dist");
const runtime = resolve("packages/loculus/node_modules/loculus/dist/index.js");
const modes = ["auto", "unroll", "loop", "chunked", false] as const;
const invocations = [
  ["--help"],
  ["--help-all"],
  ["--help-json"],
  ["--version"],
  ["serve", "--help"],
  ["serve", "input.txt", "-p", "8080", "--no-cache", "--tags", "a"],
  ["serve", "input.txt", "-p", "0"],
  ["variant", "--kind", "rollback", "--revision", "2"],
  ["--verbose", "serve", "input.txt"],
  ["deferred", "input.txt"],
  ["literal", "--confirm", "--code", "42"],
  ["numeric", "--edition", "2", "--count", "3"],
  ["boolean", "--enabled=false", "--reason", "maintenance"],
  ["choices", "--count", "2", "--enabled=false", "--mode", "auto"],
  ["mixed", "--mode", "2", "--count", "3"],
];
let directory: string;
let baseline: BuildResult;

async function build(mode?: (typeof modes)[number]): Promise<BuildResult> {
  let transformed = false;
  const bundle = await rolldown({
    input: fixture,
    external: (id) =>
      id.startsWith("node:") || ["yaml", "@clack/prompts", "@inquirer/prompts"].includes(id),
    plugins: [
      {
        name: "loculus-fixture-imports",
        resolveId(id) {
          if (id === "loculus") return runtime;
          if (id === "@politty/loculus") return join(dist, "index.js");
          if (id.startsWith("@politty/loculus/")) {
            return join(dist, `${id.slice("@politty/loculus/".length)}.js`);
          }
          return undefined;
        },
      },
      ...(mode === undefined ? [] : [loculusPlugin({ objects: mode })]),
      {
        name: "verify-fixture-transformation",
        transform(code, id) {
          if (resolve(id) === fixture) transformed = code !== readFileSync(fixture, "utf8");
        },
      },
    ],
  });
  try {
    const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
    const chunk = output.find((item) => item.type === "chunk");
    if (!chunk) throw new Error("Rolldown produced no entry chunk");
    const file = join(directory, "cli.mjs");
    writeFileSync(file, chunk.code);
    const env = {
      ...process.env,
      POLITTY_NO_AGENT: "1",
      NO_COLOR: "1",
      XDG_CACHE_HOME: join(directory, "cache"),
    };
    const probe = JSON.parse(
      execFileSync(process.execPath, [file], {
        env: { ...env, POLITTY_ROLLDOWN_PROBE: "1" },
        encoding: "utf8",
        timeout: 15000,
        maxBuffer: 8 * 1024 * 1024,
      }),
    ) as Probe;
    const executions = invocations.map((argv) => {
      const result = spawnSync(process.execPath, [file, ...argv], {
        env,
        encoding: "utf8",
        timeout: 15000,
      });
      if (result.error) throw result.error;
      return { argv, status: result.status, stdout: result.stdout, stderr: result.stderr };
    });
    return { probe, executions, transformed };
  } finally {
    await bundle.close();
  }
}

describe("Loculus Rolldown bundles", () => {
  beforeAll(async () => {
    directory = mkdtempSync(join(tmpdir(), "politty-loculus-rolldown-"));
    baseline = await build();
  }, 30000);
  afterAll(() => {
    if (directory) rmSync(directory, { recursive: true, force: true });
  });
  it("runs the baseline CLI and generates help, docs, completion and prompts", () => {
    expect(baseline.transformed).toBe(false);
    expect(baseline.probe.outcomes).toHaveLength(38);
    expect(baseline.probe.outcomes.filter((outcome) => !outcome.success)).toHaveLength(11);
    expect(baseline.probe.outcomes[1]?.result).toMatchObject({
      port: 8080,
      cache: false,
      tags: ["a", "b"],
    });
    expect(baseline.probe.outcomes[27]?.result).toMatchObject({
      count: 2,
      enabled: false,
      mode: "auto",
    });
    expect(baseline.probe.outcomes[32]?.result).toMatchObject({ mode: 2, count: 3 });
    expect(baseline.probe.docSuccess).toBe(true);
    expect(baseline.probe.doc).toContain("# serve");
    expect(baseline.probe.templateDoc).toContain("--port");
    expect(baseline.probe.prompted).toEqual({ name: "Alice" });
    expect(baseline.probe.promptRun).toMatchObject({ success: true, result: { name: "Alice" } });
    expect(Object.keys(baseline.probe.completions)).toEqual(["bash", "zsh", "fish"]);
    expect(baseline.executions[0]).toMatchObject({ status: 0 });
    expect(baseline.executions[0]?.stdout).toContain("Usage:");
    expect(baseline.executions[5]).toMatchObject({ status: 0 });
    expect(baseline.executions[5]?.stdout).toContain('"port":8080');
    expect(baseline.executions[6]).toMatchObject({ status: 1 });
    expect(baseline.executions[6]?.stderr).toContain("Expected at least 1");
  });
  it.each(modes)("preserves post-bundle behavior with objects=%s", async (mode) => {
    const result = await build(mode);
    expect(result.transformed).toBe(true);
    expect(result.probe).toEqual(baseline.probe);
    expect(result.executions).toEqual(baseline.executions);
  });
});
