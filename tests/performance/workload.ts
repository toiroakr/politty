import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import type { runCommand } from "../../packages/core/src/core/runner.js";
import type { extractFields } from "../../packages/core/src/core/schema-extractor.js";
import type { generateHelp } from "../../packages/core/src/output/help-generator.js";
import { buildParserOptions, parseArgv } from "../../packages/core/src/parser/argv-parser.js";
import type { AnyCommand, ArgsSchema } from "../../packages/core/src/types.js";
import type { generateCompletion } from "../../packages/zod/src/completion.js";

export interface BenchmarkApi {
  runCommand: typeof runCommand;
  extractFields: typeof extractFields;
  generateHelp: typeof generateHelp;
  generateCompletion: typeof generateCompletion;
  validate: (
    raw: Record<string, unknown>,
    schema: ArgsSchema,
  ) => { success: boolean; data?: unknown };
}
export type Metric = { key: string; name: string; value: number; unit: string };
export type Scenario = { key: string; name: string; batch: () => void | Promise<void> };
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
export async function createScenarios(
  schema: ArgsSchema,
  adapter: string,
  label: string,
  root: AnyCommand,
  api: BenchmarkApi,
  binPath: string,
): Promise<Scenario[]> {
  const suffix = adapter === "zod" ? "" : `_${adapter}`;
  const argv = ["input.ts", "-v", "--count", "3", "--mode=release", "-t", "one", "-t", "two"];
  const extracted = api.extractFields(schema);
  const parserOptions = buildParserOptions(extracted);

  assert.equal(extracted.fields.length, 5);
  assert.deepEqual(parseArgv(argv, parserOptions), {
    options: { verbose: true, count: "3", mode: "release", tags: ["one", "two"] },
    positionals: ["input.ts"],
    rest: [],
  });
  const result = await api.runCommand<string>(root, ["build", ...argv]);
  assert.ok(result.success, result.error?.message);
  assert.equal(result.result, "input.ts:3");
  assert.ok(api.generateHelp(root, { showSubcommandOptions: true }).includes("--count"));

  const validation = api.validate(
    { file: "input.ts", verbose: true, count: "3", mode: "release", tags: ["one", "two"] },
    schema,
  );
  assert.ok(validation.success);
  assert.deepEqual(validation.data, {
    file: "input.ts",
    verbose: true,
    count: 3,
    mode: "release",
    tags: ["one", "two"],
  });
  const defaults = api.validate({ file: "input.ts" }, schema);
  assert.ok(defaults.success);
  assert.deepEqual(defaults.data, { file: "input.ts", verbose: false, count: 1, mode: "debug" });
  assert.equal(api.validate({ file: "input.ts", mode: "invalid" }, schema).success, false);
  for (const count of ["Infinity", "-Infinity", "invalid"]) {
    assert.equal(api.validate({ file: "input.ts", count }, schema).success, false);
  }
  const raw = {
    file: "input.ts",
    verbose: true,
    count: "3",
    mode: "release",
    tags: ["one", "two"],
  };
  const scenarios: Scenario[] = [
    syncScenario(`extract_fields_${adapter}`, `${label} schema extraction (warm cache)`, () =>
      api.extractFields(schema),
    ),
    {
      key: `run_command_${adapter}`,
      name: `Subcommand execution (${label})`,
      batch: async () => {
        for (let i = 0; i < batchSize; i++) {
          const execution = await api.runCommand(root, ["build", ...argv]);
          if (!execution.success) throw execution.error;
          lastResult = execution.result;
        }
      },
    },
    syncScenario(`generate_help${suffix}`, `Help generation (${label})`, () =>
      api.generateHelp(root, { showSubcommandOptions: true }),
    ),
  ];
  if (adapter.startsWith("loculus")) {
    scenarios.unshift(
      syncScenario(`validate_schema_${adapter}`, `Native schema validation (${label})`, () =>
        api.validate(raw, schema),
      ),
    );
  }
  for (const shell of ["bash", "zsh", "fish"] as const) {
    for (const mode of ["static", "dispatcher"] as const) {
      const options = { shell, mode, programName: root.name, binPath };
      assert.ok(api.generateCompletion(root, options).script.length > 0);
      scenarios.push(
        syncScenario(
          `completion_${shell}_${mode}${suffix}`,
          `${shell} completion (${mode}, ${label})`,
          () => api.generateCompletion(root, options),
        ),
      );
    }
  }

  if (adapter === "zod") {
    scenarios.unshift(
      syncScenario("parse_argv", "Argument parsing", () => parseArgv(argv, parserOptions)),
    );
  }
  return scenarios;
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

export async function measureScenarios(
  scenarios: Scenario[],
  log: (message: string) => void = console.log,
): Promise<Metric[]> {
  const metrics: Metric[] = [];
  for (const scenario of scenarios) {
    await sample(scenario, 300);
    const samples = [];
    for (let i = 0; i < 7; i++) samples.push(await sample(scenario, 250));
    samples.sort((a, b) => a - b);
    const value = samples[3]!;
    assert.ok(Number.isFinite(value) && value > 0);
    metrics.push({ key: scenario.key, name: scenario.name, value, unit: " ns/op" });
    log(
      `${scenario.name}: ${value.toFixed(1)} ns/op (range ${samples[0]!.toFixed(1)}–${samples[6]!.toFixed(1)})`,
    );
  }
  assert.notEqual(lastResult, undefined);
  return metrics;
}
