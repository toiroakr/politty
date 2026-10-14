import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { AnyCommand, ArgsSchema } from "../../packages/core/src/types.js";
import { createScenarios, measureScenarios, type BenchmarkApi } from "./workload.js";

const [file, key, label] = process.argv.slice(2);
assert.ok(file && key && label);
const fixture = (await import(pathToFileURL(file).href)) as {
  schema: ArgsSchema;
  root: AnyCommand;
  api: BenchmarkApi;
};
const scenarios = await createScenarios(
  fixture.schema,
  key,
  label,
  fixture.root,
  fixture.api,
  fileURLToPath(import.meta.url),
);
const metrics = await measureScenarios(scenarios, (message) => console.error(message));
console.log(JSON.stringify(metrics));
