import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { arg } from "../../packages/core/src/core/arg-registry.js";
import { defineCommand } from "../../packages/core/src/core/command.js";
import { runCommand } from "../../packages/core/src/core/runner.js";
import { extractFields } from "../../packages/core/src/core/schema-extractor.js";
import { generateHelp } from "../../packages/core/src/output/help-generator.js";
import { buildParserOptions, parseArgv } from "../../packages/core/src/parser/argv-parser.js";
import { generateCompletion } from "../../packages/zod/src/completion.js";
import "../../packages/zod/src/register.js";

const schema = z.object({
  file: arg(z.string(), { positional: true, description: "Input file" }),
  verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose output" }),
  count: arg(z.coerce.number().default(1), { alias: "c", description: "Repeat count" }),
  mode: arg(z.enum(["debug", "release"]).default("debug"), { description: "Build mode" }),
  tags: arg(z.array(z.string()).optional(), { alias: "t", description: "Build tags" }),
});
function createSubcommand(name: string) {
  return defineCommand({
    name,
    description: `${name} a project`,
    args: schema,
    run: ({ file, count }) => `${file}:${count}`,
  });
}
const root = defineCommand({
  name: "bench-cli",
  description: "Benchmark CLI",
  subCommands: {
    build: createSubcommand("build"),
    check: createSubcommand("check"),
    deploy: createSubcommand("deploy"),
  },
});
const argv = ["input.ts", "-v", "--count", "3", "--mode=release", "-t", "one", "-t", "two"];
const extracted = extractFields(schema);
const parserOptions = buildParserOptions(extracted);

assert.equal(extracted.fields.length, 5);
assert.deepEqual(parseArgv(argv, parserOptions), {
  options: { verbose: true, count: "3", mode: "release", tags: ["one", "two"] },
  positionals: ["input.ts"],
  rest: [],
});
const result = await runCommand<string>(root, ["build", ...argv]);
assert.ok(result.success, result.error?.message);
assert.equal(result.result, "input.ts:3");
assert.ok(generateHelp(root, { showSubcommandOptions: true }).includes("--count"));

type Scenario = { key: string; name: string; batch: () => void | Promise<void> };
const batchSize = 100;
let lastResult: unknown;
function syncScenario(key: string, name: string, operation: () => unknown): Scenario {
  return {
    key,
    name,
    batch: () => {
      for (let i = 0; i < batchSize; i++) lastResult = operation();
    },
  };
}
const scenarios: Scenario[] = [
  syncScenario("parse_argv", "Argument parsing", () => parseArgv(argv, parserOptions)),
  syncScenario("extract_fields_zod", "Zod schema extraction (warm cache)", () =>
    extractFields(schema),
  ),
  {
    key: "run_command_zod",
    name: "Subcommand execution (Zod)",
    batch: async () => {
      for (let i = 0; i < batchSize; i++) {
        const execution = await runCommand(root, ["build", ...argv]);
        if (!execution.success) throw execution.error;
        lastResult = execution.result;
      }
    },
  },
  syncScenario("generate_help", "Help generation", () =>
    generateHelp(root, { showSubcommandOptions: true }),
  ),
];
const binPath = fileURLToPath(import.meta.url);
for (const shell of ["bash", "zsh", "fish"] as const) {
  for (const mode of ["static", "dispatcher"] as const) {
    const options = { shell, mode, programName: root.name, binPath };
    assert.ok(generateCompletion(root, options).script.length > 0);
    scenarios.push(
      syncScenario(`completion_${shell}_${mode}`, `${shell} completion (${mode})`, () =>
        generateCompletion(root, options),
      ),
    );
  }
}

async function sample(scenario: Scenario, durationMs: number): Promise<number> {
  let iterations = 0;
  const start = performance.now();
  let elapsed: number;
  do {
    await scenario.batch();
    iterations += batchSize;
    elapsed = performance.now() - start;
  } while (elapsed < durationMs);
  return (elapsed * 1_000_000) / iterations;
}

const metrics = [];
for (const scenario of scenarios) {
  await sample(scenario, 300);
  const samples = [];
  for (let i = 0; i < 7; i++) samples.push(await sample(scenario, 250));
  samples.sort((a, b) => a - b);
  const value = samples[3]!;
  assert.ok(Number.isFinite(value) && value > 0);
  metrics.push({ key: scenario.key, name: scenario.name, value, unit: "ns/op" });
  console.log(
    `${scenario.name}: ${value.toFixed(1)} ns/op (range ${samples[0]!.toFixed(1)}–${samples[6]!.toFixed(1)})`,
  );
}
assert.notEqual(lastResult, undefined);

await mkdir("benchmark-results", { recursive: true });
await writeFile(
  "benchmark-results/octocov.json",
  `${JSON.stringify(
    {
      key: "politty_runtime_v1",
      name: "Runtime performance (lower is better)",
      metadata: [
        { key: "node", name: "Node.js", value: process.version },
        { key: "platform", name: "Platform", value: `${platform()}/${arch()}` },
        { key: "sampling", value: "300 ms warmup; median of 7 x 250 ms samples; 100 ops/batch" },
      ],
      metrics,
    },
    null,
    2,
  )}\n`,
);
