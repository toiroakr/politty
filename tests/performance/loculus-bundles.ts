import { loculusPlugin } from "@loculus/rolldown";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";
import { gzipSync } from "node:zlib";
import { rolldown } from "rolldown";
import type { Metric } from "./workload.js";

const execute = promisify(execFile);
const fixture = resolve("tests/performance/fixtures/loculus-cli.mjs");
const dist = resolve("packages/loculus/dist");
const runtime = resolve("packages/loculus/node_modules/loculus/dist/index.js");

async function build(input: string, file: string, optimized = false): Promise<Buffer> {
  let transformed = false;
  const bundle = await rolldown({
    input,
    external: (id) =>
      id.startsWith("node:") || ["yaml", "@clack/prompts", "@inquirer/prompts"].includes(id),
    plugins: [
      {
        name: "benchmark-imports",
        resolveId(id) {
          if (id === "loculus") return runtime;
          if (id === "@politty/loculus") return join(dist, "index.js");
          if (id === "@politty/loculus/completion") return join(dist, "completion.js");
          return undefined;
        },
      },
      ...(optimized ? [loculusPlugin()] : []),
      {
        name: "verify-benchmark-specialization",
        async transform(code, id) {
          if (resolve(id) === fixture) transformed = code !== (await readFile(fixture, "utf8"));
        },
      },
    ],
  });
  try {
    const { output } = await bundle.generate({ format: "esm", codeSplitting: false });
    const chunk = output.find((item) => item.type === "chunk");
    assert.ok(chunk);
    if (optimized) assert.ok(transformed, "Loculus benchmark schema was not specialized");
    const code = Buffer.from(chunk.code);
    await writeFile(file, code);
    return code;
  } finally {
    await bundle.close();
  }
}

export async function measureLoculusBundles(): Promise<Metric[]> {
  const directory = await mkdtemp(join(tmpdir(), "politty-benchmark-"));
  const env = {
    ...process.env,
    POLITTY_NO_AGENT: "1",
    NODE_DISABLE_COMPILE_CACHE: "1",
    XDG_CACHE_HOME: join(directory, "cache"),
  };
  const metrics: Metric[] = [];
  try {
    const driver = join(directory, "driver.mjs");
    await build(resolve("tests/performance/loculus-driver.ts"), driver);
    const bundles: Array<{ key: string; label: string; file: string; samples: number[] }> = [];
    for (const optimized of [false, true]) {
      const key = optimized ? "loculus_optimized" : "loculus";
      const label = optimized ? "Loculus (Rolldown optimized)" : "Loculus (unoptimized bundle)";
      const file = join(directory, `${key}.mjs`);
      const code = await build(fixture, file, optimized);
      metrics.push({
        key: `bundle_bytes_${key}`,
        name: `Bundle size (${label})`,
        value: code.length,
        unit: " bytes",
      });
      metrics.push({
        key: `bundle_gzip_bytes_${key}`,
        name: `Gzipped bundle size (${label})`,
        value: gzipSync(code).length,
        unit: " bytes",
      });
      bundles.push({ key, label, file, samples: [] as number[] });
      const result = await execute(process.execPath, [driver, file, key, label], {
        env,
        timeout: 60000,
        maxBuffer: 8 * 1024 * 1024,
      });
      process.stdout.write(result.stderr);
      const measured = JSON.parse(result.stdout) as Metric[];
      assert.equal(measured.length, 10);
      for (const metric of measured) assert.ok(Number.isFinite(metric.value) && metric.value > 0);
      metrics.push(...measured);
    }
    for (let sample = 0; sample < 11; sample++) {
      for (const bundle of sample % 2 === 0 ? bundles : [...bundles].reverse()) {
        const start = performance.now();
        const result = await execute(process.execPath, [bundle.file, "--startup"], {
          env,
          timeout: 10000,
          maxBuffer: 1024 * 1024,
        });
        const elapsed = performance.now() - start;
        assert.equal(JSON.parse(result.stdout), "input.ts:3");
        if (sample >= 2) bundle.samples.push(elapsed);
      }
    }
    for (const bundle of bundles) {
      bundle.samples.sort((a, b) => a - b);
      const value = bundle.samples[4]!;
      assert.ok(Number.isFinite(value) && value > 0);
      metrics.push({
        key: `startup_ms_${bundle.key}`,
        name: `Fresh process startup (${bundle.label})`,
        value,
        unit: " ms",
      });
      console.log(
        `${bundle.label} startup: ${value.toFixed(2)} ms (range ${bundle.samples[0]!.toFixed(2)}–${bundle.samples[8]!.toFixed(2)})`,
      );
    }
    return metrics;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
