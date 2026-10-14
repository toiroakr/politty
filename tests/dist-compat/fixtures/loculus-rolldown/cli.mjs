import * as l from "loculus";
import {
  arg,
  defineCommand,
  runCommand,
  runMain,
  generateHelp,
  generateHelpData,
  extractFields,
  lazy,
} from "@politty/loculus";
import { renderArgsTable, generateDoc } from "@politty/loculus/docs";
import { generateCompletion, parseCompletionContext } from "@politty/loculus/completion";
import { promptMissingArgs } from "@politty/loculus/prompt";
import { writeFileSync, readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
const events = [];
const finish = (a) => {
  const result = { ...a };
  if (!process.env.POLITTY_ROLLDOWN_PROBE) console.log(JSON.stringify(result));
  return result;
};
const serve = defineCommand({
  name: "serve",
  description: "サーバー起動",
  args: l.object({
    file: arg(l.string(), { positional: true, description: "入力ファイル" }),
    port: arg(l.number({ integer: true, gte: 1, default: 3000 }), {
      alias: "p",
      env: "CHECK_PORT",
      effect: (v) => events.push(v),
    }),
    cache: arg(l.boolean({ default: true }), { negation: true }),
    mode: l.enum(["dev", "prod"], { default: "dev" }),
    tags: l.array(l.enum(["a", "b"]), { optional: true }),
  }),
  run: finish,
});
const variant = defineCommand({
  name: "variant",
  args: l.discriminatedUnion("kind", [
    l.object({ kind: l.literal("deploy"), name: l.string() }),
    l.object({ kind: l.literal("rollback"), revision: l.number({ gte: 1 }) }),
  ]),
  run: finish,
});
const union = defineCommand({
  name: "union",
  args: l.union([
    l.object({ kind: l.literal("deploy"), name: l.string() }),
    l.object({ kind: l.literal("rollback"), revision: l.number({ gte: 1 }) }),
  ]),
  run: finish,
});
const xor = defineCommand({
  name: "xor",
  args: l.xor([
    l.object({ kind: l.literal("deploy"), name: l.string() }),
    l.object({ kind: l.literal("rollback"), revision: l.number({ gte: 1 }) }),
  ]),
  run: finish,
});
const combined = defineCommand({
  name: "combined",
  args: l.intersection(
    l.object({ name: l.string() }, { unknownKeys: "strip" }),
    l.object({ port: l.number({ default: 3000 }) }, { unknownKeys: "strip" }),
  ),
  run: finish,
});
const wrapped = defineCommand({
  name: "wrapped",
  args: l.transform(
    l.object({
      port: arg(
        l.refine(l.number({ default: 3000 }), (n) => n > 0, "positive"),
        { alias: "p" },
      ),
    }),
    (a) => ({ ...a, port: a.port + 1 }),
  ),
  run: finish,
});
const env = defineCommand({
  name: "env",
  args: l.object({ tags: arg(l.array(l.string(), { wrapScalar: true }), { env: "CHECK_TAGS" }) }),
  run: finish,
});
const dynamicMin = Number(process.env.CHECK_MIN || "2");
const dynamic = defineCommand({
  name: "dynamic",
  args: l.object({ count: l.number({ gte: dynamicMin }) }),
  run: finish,
});
const promptCmd = defineCommand({
  name: "prompt",
  args: l.object({ name: arg(l.string({ min: 2 }), { prompt: { message: "名前" } }) }),
  run: finish,
});
const literal = defineCommand({
  name: "literal",
  args: l.object({ confirm: l.literal(true), code: l.literal(42) }),
  run: finish,
});
const numeric = defineCommand({
  name: "numeric",
  args: l.discriminatedUnion("edition", [
    l.object({ edition: l.literal(1), name: l.string() }),
    l.object({ edition: l.literal(2), count: l.number() }),
  ]),
  run: finish,
});
const boolean = defineCommand({
  name: "boolean",
  args: l.discriminatedUnion("enabled", [
    l.object({ enabled: l.literal(true), name: l.string() }),
    l.object({ enabled: l.literal(false), reason: l.string() }),
  ]),
  run: finish,
});
const choices = defineCommand({
  name: "choices",
  args: l.object({
    count: l.literal([1, 2, 3]),
    enabled: l.literal([true, false]),
    mode: l.literal([true, "auto"]),
  }),
  run: finish,
});
const mixed = defineCommand({
  name: "mixed",
  args: l.discriminatedUnion("mode", [
    l.object({ mode: l.literal([1, "auto"]), name: l.string() }),
    l.object({ mode: l.literal([false, 2]), count: l.number() }),
  ]),
  run: finish,
});
const globalArgs = l.object({ verbose: arg(l.boolean({ default: false }), { alias: "v" }) });
const layouts = defineCommand({
  name: "layouts",
  args: l.discriminatedUnion("edition", [
    l.object({ edition: l.literal(1), value: l.boolean() }),
    l.object({ edition: l.literal(2), value: l.string() }),
  ]),
  run: finish,
});
const nestedLayouts = defineCommand({
  name: "nested-layouts",
  args: l.union([layouts.args, l.object({ other: l.string() })]),
  run: finish,
});
const promptVariant = defineCommand({
  name: "prompt-variant",
  args: l.discriminatedUnion("edition", [
    l.object({ edition: l.literal(1), flag: arg(l.boolean(), { prompt: { message: "Flag?" } }) }),
    l.object({ edition: l.literal(2), name: arg(l.string(), { prompt: { message: "Name?" } }) }),
  ]),
  run: finish,
});
const numericUnion = defineCommand({
  name: "numeric-union",
  args: l.union([numeric.args, l.object({ other: l.string() })]),
  run: finish,
});
const numericXor = defineCommand({
  name: "numeric-xor",
  args: l.xor([numeric.args, l.object({ other: l.string() })]),
  run: finish,
});
const numericIntersection = defineCommand({
  name: "numeric-intersection",
  args: l.intersection(
    numeric.args,
    l.object({ suffix: l.string({ default: "!" }) }, { unknownKeys: "strip" }),
  ),
  run: finish,
});
const cli = defineCommand({
  name: "app",
  description: "統合確認",
  subCommands: {
    layouts,
    "nested-layouts": nestedLayouts,
    "prompt-variant": promptVariant,
    "numeric-union": numericUnion,
    "numeric-xor": numericXor,
    "numeric-intersection": numericIntersection,
    choices,
    mixed,
    literal,
    numeric,
    boolean,
    serve,
    variant,
    union,
    xor,
    combined,
    wrapped,
    env,
    dynamic,
    prompt: promptCmd,
    deferred: lazy(serve, async () => serve),
  },
});
if (!process.env.POLITTY_ROLLDOWN_PROBE) await runMain(cli, { globalArgs, version: "1.2.3" });
else {
  const outcomes = [];
  const inputs = [
    ["serve", "input.txt"],
    ["serve", "input.txt", "-p", "8080", "--no-cache", "--tags", "a", "--tags", "b"],
    ["serve", "input.txt", "--tags", "a"],
    ["serve", "input.txt", "-p", "0"],
    ["serve", "input.txt", "--mode", "invalid"],
    ["serve"],
    ["serve", "input.txt", "--extra"],
    ["--verbose", "serve", "input.txt"],
    ["variant", "--kind", "deploy", "--name", "app"],
    ["variant", "--kind", "rollback", "--revision", "2"],
    ["variant", "--kind", "rollback"],
    ["union", "--kind", "deploy", "--name", "app"],
    ["xor", "--kind", "rollback", "--revision", "2"],
    ["combined", "--name", "app"],
    ["wrapped"],
    ["wrapped", "-p", "8080"],
    ["dynamic", "--count", "1"],
    ["dynamic", "--count", "2"],
    ["deferred", "input.txt"],
    ["literal", "--confirm", "--code", "42"],
    ["literal", "--confirm", "--code", "43"],
    ["numeric", "--edition", "1", "--name", "app"],
    ["numeric", "--edition", "2", "--count", "3"],
    ["boolean", "--enabled", "--name", "app"],
    ["boolean", "--enabled=false", "--reason", "maintenance"],
    ["numeric", "--edition", "2"],
    ["numeric", "--edition", "3"],
    ["choices", "--count", "2", "--enabled=false", "--mode", "auto"],
    ["choices", "--count", "1", "--enabled", "--mode", "true"],
    ["mixed", "--mode", "1", "--name", "app"],
    ["mixed", "--mode", "auto", "--name", "app"],
    ["mixed", "--mode", "false", "--count", "3"],
    ["mixed", "--mode", "2", "--count", "3"],
    ["mixed", "--mode", "2"],
    ["choices", "--count", "4", "--enabled", "--mode", "auto"],
    ["layouts", "--edition", "2.0", "--value", "hello"],
    ["layouts", "--edition", "2e0", "--value", "hello"],
    ["numeric-union", "--edition", "2.0", "--count", "3"],
    ["numeric-xor", "--edition", "2.0", "--count", "3"],
    ["numeric-intersection", "--edition", "2.0", "--count", "3"],
  ];
  for (const argv of inputs) {
    events.length = 0;
    const r = await runCommand(cli, argv, { globalArgs });
    outcomes.push({
      argv,
      success: r.success,
      result: r.result,
      error: r.error?.message,
      exitCode: r.exitCode,
      logs: r.logs,
      events: [...events],
    });
  }
  process.env.CHECK_PORT = "8080";
  for (const argv of [
    ["serve", "input.txt"],
    ["serve", "input.txt", "-p", "9000"],
  ]) {
    const r = await runCommand(cli, argv, { globalArgs });
    outcomes.push({ argv, success: r.success, result: r.result });
  }
  delete process.env.CHECK_PORT;
  process.env.CHECK_TAGS = "alpha";
  const er = await runCommand(cli, ["env"], { globalArgs });
  outcomes.push({ env: er.result, success: er.success });
  delete process.env.CHECK_TAGS;
  const prompted = await promptMissingArgs({}, extractFields(promptCmd.args), {
    interactive: true,
    adapter: {
      text: async () => "Alice",
      password: async () => "Alice",
      confirm: async () => true,
      select: async () => "Alice",
      isCancelled: () => false,
    },
  });
  const promptRun = await runCommand(promptCmd, ["--name", prompted.name]);
  const variantPromptRun = await runCommand(promptVariant, ["--edition", "2.0"], {
    prompt: (raw, fields) =>
      promptMissingArgs(raw, fields, {
        interactive: true,
        adapter: {
          text: async () => "Alice",
          password: async () => "Alice",
          confirm: async () => true,
          select: async () => "Alice",
          isCancelled: () => false,
        },
      }),
  });
  const completionLayouts = [layouts, nestedLayouts].flatMap((command) =>
    ["2", "2.0", "2e0"].map((spelling) => {
      const context = parseCompletionContext(["--edition", spelling, "--value", ""], command);
      return { completionType: context.completionType, targetOption: context.targetOption };
    }),
  );
  let collisionError;
  try {
    extractFields(
      l.discriminatedUnion("edition", [
        l.object({ edition: l.literal(1) }),
        l.object({ edition: l.literal("1") }),
      ]),
    );
  } catch (error) {
    collisionError = error.message;
  }
  const help = {};
  for (const [name, cmd] of Object.entries(cli.subCommands)) {
    const command = name === "deferred" ? serve : cmd;
    help[name] = { plain: generateHelp(command, {}), json: generateHelpData(command) };
  }
  const completions = {};
  for (const shell of ["bash", "zsh", "fish"])
    completions[shell] = generateCompletion(cli, {
      shell,
      programName: "app",
      globalArgs,
      binPath: "/opt/politty-integration/app",
    }).script;
  const dir = mkdtempSync(tmpdir() + "/politty-doc-integration-");
  let doc, templateDoc, docSuccess;
  process.env.POLITTY_DOCS_UPDATE = "true";
  try {
    const path = dir + "/cli.md";
    const result = await generateDoc({ command: cli, files: { [path]: [""] }, globalArgs });
    doc = readFileSync(path, "utf8");
    docSuccess = result.success;
    const template = dir + "/template.md",
      output = dir + "/template-output.md";
    writeFileSync(
      template,
      "# CLI\n{{politty:command:serve:usage}}\n{{politty:command:serve:options}}\n",
    );
    const tr = await generateDoc({ command: cli, templates: { [output]: template }, globalArgs });
    templateDoc = readFileSync(output, "utf8");
    docSuccess = docSuccess && tr.success;
  } finally {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.POLITTY_DOCS_UPDATE;
  }
  console.log(
    JSON.stringify({
      outcomes,
      completionLayouts,
      collisionError,
      prompted,
      promptRun: { success: promptRun.success, result: promptRun.result },
      variantPromptRun: { success: variantPromptRun.success, result: variantPromptRun.result },
      help,
      table: renderArgsTable(serve.args.shape),
      completions,
      doc,
      templateDoc,
      docSuccess,
    }),
  );
}
