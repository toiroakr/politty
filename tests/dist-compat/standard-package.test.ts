import { execSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import * as v from "valibot";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import type * as StandardCompletion from "../../packages/politty/src/standard-completion.js";
import type * as StandardDocs from "../../packages/politty/src/standard-docs.js";
import type * as Standard from "../../packages/politty/src/standard.js";
import type * as ZodPolitty from "../../packages/zod/src/index.js";

const requireFromPolitty = createRequire(
  new URL("../../packages/politty/package.json", import.meta.url),
);

function importSubpath<Module>(name: string): Promise<Module> {
  return import(pathToFileURL(requireFromPolitty.resolve(name)).href);
}

const standard = () => importSubpath<typeof Standard>("politty/standard");

describe("politty/standard", () => {
  it("preserves typed output and requires the input converter in the shipped declarations", () => {
    const workspace = fileURLToPath(new URL("../..", import.meta.url));
    execSync("pnpm exec tsgo -p tests/dist-compat/fixtures/standard-types", { cwd: workspace });
  });

  it("uses input fields for argv, help, and shell completion and preserves validated output", async () => {
    const { defineCommand, generateHelp, runCommand, standardArgs } = await standard();
    const { generateCompletion } = await importSubpath<typeof StandardCompletion>(
      "politty/standard/completion",
    );
    const { buildCommandInfo } = await importSubpath<typeof StandardDocs>("politty/standard/docs");
    const command = defineCommand({
      name: "search",
      args: standardArgs(
        z.object({
          query: z.string().transform((text) => text.length),
          mode: z.enum(["fast", "safe"]).describe("Search strategy").default("safe"),
          loud: z.boolean().default(false),
          include: z.array(z.enum(["x", "y"])).default([]),
        }),
        { fields: { query: { positional: true }, loud: { alias: "l" } } },
      ),
      run: ({ query, loud, mode, include }) => {
        expectTypeOf(query).toEqualTypeOf<number>();
        return { query, loud, mode, include };
      },
    });

    expect(
      await runCommand(command, ["hello", "-l", "--include", "x", "--include", "y"]),
    ).toMatchObject({
      success: true,
      result: { query: 5, loud: true, mode: "safe", include: ["x", "y"] },
    });
    expect(generateHelp(command, {})).toContain("Search strategy");
    const script = generateCompletion(command, { shell: "bash", programName: "search" }).script;
    expect(script).toContain('"fast" "safe"');
    expect(script).toContain('"x" "y"');
    expect(
      (await buildCommandInfo(command, "search")).positionalArgs.map(({ name }) => name),
    ).toEqual(["query"]);
    expect(await runCommand(command, ["hello", "--mode", "invalid"])).toMatchObject({
      success: false,
      error: { message: expect.stringContaining("mode") },
    });
  });

  it("parses boolean literal unions and completes string literal unions", async () => {
    const { defineCommand, runCommand } = await standard();
    const { generateCompletion } = await importSubpath<typeof StandardCompletion>(
      "politty/standard/completion",
    );
    const command = defineCommand({
      name: "render",
      args: z.object({
        flag: z.union([z.literal(true), z.literal(false)]),
        mode: z.union([z.literal("json"), z.literal("plain")]),
      }),
      run: ({ flag, mode }) => ({ flag, mode }),
    });
    expect(await runCommand(command, ["--mode", "json", "--flag=false"])).toMatchObject({
      success: true,
      result: { flag: false, mode: "json" },
    });
    expect(generateCompletion(command, { shell: "bash", programName: "render" }).script).toContain(
      '"json" "plain"',
    );
  });

  it("accepts metadata keyed by the input even when validation changes the output shape", async () => {
    const { defineCommand, runCommand, standardArgs } = await standard();
    const command = defineCommand({
      name: "greet",
      args: standardArgs(
        z
          .object({ firstName: z.string() })
          .transform(({ firstName }) => ({ greeting: `Hello ${firstName}` })),
        { fields: { firstName: { positional: true } } },
      ),
      run: (args) => {
        expectTypeOf(args.greeting).toEqualTypeOf<string>();
        return args.greeting;
      },
    });
    expect(await runCommand(command, ["Ada"])).toMatchObject({
      success: true,
      result: "Hello Ada",
    });
  });

  it.each(["additionalProperties", "unevaluatedProperties"])(
    "uses a separate converter and rejects unknown flags with %s: false",
    async (closedObjectKeyword) => {
      const { defineCommand, runCommand, standardArgs } = await standard();
      const schema = v.strictObject({ name: v.pipe(v.string(), v.toUpperCase()) });
      const jsonSchema = {
        "~standard": {
          version: 1,
          jsonSchema: {
            input: () => ({
              $ref: "#/$defs/args",
              $defs: {
                args: {
                  type: "object",
                  [closedObjectKeyword]: false,
                  patternProperties: {},
                  properties: { name: { $ref: "#/$defs/names/anyOf/0" } },
                  required: ["name"],
                },
                names: { anyOf: [{ type: "string" }, { type: "number" }] },
              },
            }),
          },
        },
      } as const;
      const command = defineCommand({
        name: "greet",
        args: standardArgs(schema, { jsonSchema }),
        run: ({ name }) => {
          expectTypeOf(name).toEqualTypeOf<string>();
          return name;
        },
      });
      expect(await runCommand(command, ["--name", "world"])).toMatchObject({
        success: true,
        result: "WORLD",
      });
      expect(await runCommand(command, ["--name", "world", "--extra"])).toMatchObject({
        success: false,
        error: { message: "Unknown flags: extra" },
      });
    },
  );

  it("accumulates repeated values for an array literal without an explicit type", async () => {
    const { defineCommand, runCommand, standardArgs } = await standard();
    const command = defineCommand({
      name: "literal",
      args: standardArgs(z.object({ values: z.tuple([z.literal("x"), z.literal("y")]) }), {
        jsonSchema: {
          "~standard": {
            version: 1,
            jsonSchema: {
              input: () => ({
                type: "object",
                properties: { values: { const: ["x", "y"] } },
                required: ["values"],
              }),
            },
          },
        },
      }),
      run: ({ values }) => values,
    });
    expect(await runCommand(command, ["--values", "x", "--values", "y"])).toMatchObject({
      success: true,
      result: ["x", "y"],
    });
  });

  it("passes options allowed by patternProperties to the validator", async () => {
    const { defineCommand, runCommand, standardArgs } = await standard();
    const schema = v.pipe(
      v.objectWithRest({}, v.string()),
      v.check((values) => Object.keys(values).every((key) => key.startsWith("x-"))),
    );
    const command = defineCommand({
      name: "greet",
      args: standardArgs(schema, {
        jsonSchema: {
          "~standard": {
            version: 1,
            jsonSchema: {
              input: () => ({
                type: "object",
                patternProperties: { "^x-": { type: "string" } },
                additionalProperties: false,
              }),
            },
          },
        },
      }),
      run: (args) => args["x-note"],
    });
    expect(await runCommand(command, ["--x-note", "hello"])).toMatchObject({
      success: true,
      result: "hello",
    });
  });

  it("documents global flags, including an option named args", async () => {
    const { defineCommand, standardArgs } = await standard();
    const { generateDoc } = await importSubpath<typeof StandardDocs>("politty/standard/docs");
    const command = defineCommand({ name: "greet", run: () => "hello" });
    const directory = await mkdtemp(join(tmpdir(), "politty-standard-docs-"));
    const path = join(directory, "cli.md");
    vi.stubEnv("POLITTY_DOCS_UPDATE", "1");
    try {
      await expect(
        generateDoc({
          command,
          path,
          rootDoc: { path, globalOptions: { token: z.string() } },
        }),
      ).rejects.toThrow("Pass the schema as globalArgs");
      expect(
        await generateDoc({
          command,
          path,
          globalArgs: standardArgs(
            z.object({
              verbose: z.boolean().describe("Verbose logs").default(false),
              args: z.string().describe("Extra arguments"),
            }),
            { fields: { verbose: { alias: "v" } } },
          ),
        }),
      ).toMatchObject({ success: true });
      const doc = await readFile(path, "utf8");
      expect(doc).toMatch(/--verbose.*-v.*Verbose logs.*false/);
      expect(doc).toMatch(/--args.*Extra arguments.*Yes/);
    } finally {
      vi.unstubAllEnvs();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("extracts command options when an optional field refers to the root schema", async () => {
    const { defineCommand, runCommand } = await standard();
    const schema = z.object({
      name: z.string(),
      get child() {
        return schema.optional();
      },
    });
    const command = defineCommand({ name: "greet", args: schema, run: ({ name }) => name });
    expect(await runCommand(command, ["--name", "Ada"])).toMatchObject({
      success: true,
      result: "Ada",
    });
  });

  it("selects tagged branches without replacing the dedicated Zod adapter", async () => {
    const alias = await importSubpath<typeof ZodPolitty>("politty");
    const { defineCommand, generateHelpData, runCommand } = await standard();
    const { generateCompletion } = await importSubpath<typeof StandardCompletion>(
      "politty/standard/completion",
    );
    const command = defineCommand({
      name: "toggle",
      args: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("read"), count: z.coerce.number() }),
        z.object({ kind: z.literal("write"), force: z.boolean() }),
      ]),
      run: (args) => (args.kind === "write" ? args.force : args.count),
    });
    expect(await runCommand(command, ["--force", "--kind", "write"])).toMatchObject({
      success: true,
      result: true,
    });
    expect(await runCommand(command, ["--count", "3", "--kind", "read"])).toMatchObject({
      success: true,
      result: 3,
    });

    expect(
      generateHelpData(command).options.find((option) => option.name === "kind")?.enumValues,
    ).toEqual(["read", "write"]);
    expect(generateCompletion(command, { shell: "bash", programName: "toggle" }).script).toContain(
      '"read" "write"',
    );

    const nativeCommand = alias.defineCommand({
      name: "native",
      args: z.object({ force: alias.arg(z.boolean(), { alias: "f" }) }),
      run: ({ force }) => force,
    });
    expect(await alias.runCommand(nativeCommand, ["-f"])).toMatchObject({
      success: true,
      result: true,
    });
  });
});
