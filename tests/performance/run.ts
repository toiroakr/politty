import { mkdir, writeFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { fileURLToPath } from "node:url";
import * as v from "valibot";
import { z } from "zod";
import {
  getValidatorAdapter,
  registerValidatorAdapter,
} from "../../packages/core/src/adapter/registry.js";
import { arg } from "../../packages/core/src/core/arg-registry.js";
import { defineCommand } from "../../packages/core/src/core/command.js";
import { runCommand } from "../../packages/core/src/core/runner.js";
import { extractFields } from "../../packages/core/src/core/schema-extractor.js";
import { generateHelp } from "../../packages/core/src/output/help-generator.js";
import { valibotAdapter } from "../../packages/valibot/src/adapter.js";
import { zodAdapter } from "../../packages/zod/src/adapter.js";
import { generateCompletion } from "../../packages/zod/src/completion.js";
import { measureLoculusBundles } from "./loculus-bundles.js";
import { createScenarios, measureScenarios, type Metric } from "./workload.js";

const zodSchema = z.object({
  file: arg(z.string(), { positional: true, description: "Input file" }),
  verbose: arg(z.boolean().default(false), { alias: "v", description: "Verbose output" }),
  count: arg(z.coerce.number().default(1), { alias: "c", description: "Repeat count" }),
  mode: arg(z.enum(["debug", "release"]).default("debug"), { description: "Build mode" }),
  tags: arg(z.array(z.string()).optional(), { alias: "t", description: "Build tags" }),
});
const valibotSchema = v.object({
  file: arg(v.string(), { positional: true, description: "Input file" }),
  verbose: arg(v.optional(v.boolean(), false), { alias: "v", description: "Verbose output" }),
  count: arg(v.optional(v.pipe(v.unknown(), v.transform(Number), v.number(), v.finite()), 1), {
    alias: "c",
    description: "Repeat count",
  }),
  mode: arg(v.optional(v.picklist(["debug", "release"]), "debug"), { description: "Build mode" }),
  tags: arg(v.optional(v.array(v.string())), { alias: "t", description: "Build tags" }),
});
function createRoot(schema: typeof zodSchema | typeof valibotSchema) {
  const subcommand = (name: string) =>
    defineCommand({
      name,
      description: `${name} a project`,
      args: schema,
      run: ({ file, count }) => `${file}:${count}`,
    });
  return defineCommand({
    name: "bench-cli",
    description: "Benchmark CLI",
    subCommands: {
      build: subcommand("build"),
      check: subcommand("check"),
      deploy: subcommand("deploy"),
    },
  });
}

const metrics: Metric[] = [];
for (const [schema, adapter] of [
  [zodSchema, zodAdapter],
  [valibotSchema, valibotAdapter],
] as const) {
  registerValidatorAdapter(adapter);
  const key = adapter === zodAdapter ? "zod" : "valibot";
  const scenarios = await createScenarios(
    schema,
    key,
    key === "zod" ? "Zod" : "Valibot",
    createRoot(schema),
    {
      extractFields,
      runCommand,
      generateHelp,
      generateCompletion,
      validate: getValidatorAdapter().validate,
    },
    fileURLToPath(import.meta.url),
  );
  metrics.push(...(await measureScenarios(scenarios)));
}
metrics.push(...(await measureLoculusBundles()));

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
        {
          key: "startup",
          value:
            "compile cache disabled; 2 warmup launches; median of 9 fresh processes; alternating bundle order",
        },
      ],
      metrics,
    },
    null,
    2,
  )}\n`,
);
