import assert from "node:assert/strict";
import * as l from "loculus";
import { arg, defineCommand, runCommand, extractFields, generateHelp } from "@politty/loculus";
import { generateCompletion } from "@politty/loculus/completion";

export const schema = l.object(
  {
    file: arg(l.string(), { positional: true, description: "Input file" }),
    verbose: arg(l.boolean({ default: false }), { alias: "v", description: "Verbose output" }),
    count: arg(l.number({ default: 1 }), { alias: "c", description: "Repeat count" }),
    mode: arg(l.enum(["debug", "release"], { default: "debug" }), { description: "Build mode" }),
    tags: arg(l.array(l.string(), { optional: true }), { alias: "t", description: "Build tags" }),
  },
  { unknownKeys: "strip" },
);
const subcommand = (name) =>
  defineCommand({
    name,
    description: `${name} a project`,
    args: schema,
    run: ({ file, count }) => `${file}:${count}`,
  });
export const root = defineCommand({
  name: "bench-cli",
  description: "Benchmark CLI",
  subCommands: {
    build: subcommand("build"),
    check: subcommand("check"),
    deploy: subcommand("deploy"),
  },
});
export const api = {
  runCommand,
  extractFields,
  generateHelp,
  generateCompletion,
  validate: (raw) => {
    const result = schema["~standard"].validate(raw);
    return result.issues ? { success: false } : { success: true, data: result.value };
  },
};
if (process.argv[2] === "--startup") {
  const result = await runCommand(root, [
    "build",
    "input.ts",
    "-v",
    "--count",
    "3",
    "--mode=release",
    "-t",
    "one",
    "-t",
    "two",
  ]);
  assert.ok(result.success, result.error?.message);
  assert.equal(result.result, "input.ts:3");
  console.log(JSON.stringify(result.result));
}
