import { parseArgs } from "@politty/core/parser/arg-parser";
import * as l from "loculus";
import { describe, expect, it, vi } from "vitest";
import { extractLoculusFields, loculusAdapter } from "./adapter.js";
import { generateCompletion } from "./completion.js";
import { renderArgsTable } from "./docs.js";
import { arg, createDefineCommand, defineCommand, runCommand } from "./index.js";
import { promptMissingArgs } from "./prompt.js";

describe("@politty/loculus", () => {
  it("uses constructor defaults and preserves nullable metadata and output types", async () => {
    const args = l.object({
      port: arg(l.number({ default: 3000 }), { alias: "p" }),
      cache: arg(l.boolean({ default: { nullish: true } }), { negation: true }),
      tags: l.array(l.string(), { default: [] }),
      note: l.string({ nullish: true }),
    });
    const command = defineCommand({
      name: "serve",
      args,
      run: (values) => {
        values.port satisfies number;
        values.cache satisfies boolean;
        values.tags satisfies string[];
        values.note satisfies string | null | undefined;
        return values;
      },
    });
    const defaults = await runCommand(command, []);
    expect(defaults.success).toBe(true);
    expect(defaults.result).toMatchObject({ port: 3000, cache: true, tags: [] });
    const supplied = await runCommand(command, ["-p", "8080", "--no-cache", "--tags", "a"]);
    expect(supplied.result).toMatchObject({ port: 8080, cache: false, tags: ["a"] });
    const fields = extractLoculusFields(args).fields;
    expect(fields.find((field) => field.name === "port")).toMatchObject({
      required: false,
      defaultValue: 3000,
    });
    expect(fields.find((field) => field.name === "cache")).toMatchObject({
      required: false,
      defaultValue: true,
    });
    expect(loculusAdapter.validate({ note: null, cache: null }, args)).toMatchObject({
      success: true,
      data: { port: 3000, cache: true, tags: [], note: null },
    });
    const required = l.object({ name: l.string({ default: { null: "N" } }) });
    expect(extractLoculusFields(required).fields[0]).toMatchObject({
      required: true,
      defaultValue: undefined,
    });
    expect(loculusAdapter.validate({}, required).success).toBe(false);
    expect(loculusAdapter.validate({ name: null }, required)).toMatchObject({
      success: true,
      data: { name: "N" },
    });
    const docs = renderArgsTable(args.shape);
    expect(docs).toContain("3000");
  });
  it("parses aliases, positionals, repeated enums, defaults and negations", async () => {
    const command = defineCommand({
      name: "serve",
      args: l.object({
        file: arg(l.string(), { positional: true, description: "Input file" }),
        port: arg(l.number({ integer: true, gte: 1, default: 3000 }), { alias: "p" }),
        cache: arg(l.boolean({ default: true }), { negation: true }),
        tags: l.array(l.enum(["a", "b"]), { optional: true }),
      }),
      run: (args) => {
        args.port satisfies number;
        args.cache satisfies boolean;
        return { file: args.file, port: args.port, cache: args.cache, tags: args.tags };
      },
    });
    const result = await runCommand(command, [
      "input.txt",
      "-p",
      "8080",
      "--no-cache",
      "--tags",
      "a",
      "--tags",
      "b",
    ]);
    expect(result.success).toBe(true);
    expect(result.result).toEqual({
      file: "input.txt",
      port: 8080,
      cache: false,
      tags: ["a", "b"],
    });
    const defaults = await runCommand(command, ["input.txt"]);
    expect(defaults.result).toEqual({
      file: "input.txt",
      port: 3000,
      cache: true,
      tags: undefined,
    });
  });
  it("keeps metadata through wrappers and uses environment values", async () => {
    vi.stubEnv("LOCULUS_PORT", "8080");
    try {
      const port = l.transform(
        arg(l.number({ default: 3000 }), { alias: "p", env: "LOCULUS_PORT", description: "Port" }),
        (n) => n + 1,
      );
      const schema = l.object({ port });
      const extracted = extractLoculusFields(schema);
      expect(extracted.fields[0]).toMatchObject({
        alias: ["p"],
        env: "LOCULUS_PORT",
        description: "Port",
        required: false,
        defaultValue: 3000,
      });
      expect(
        (await runCommand(defineCommand({ name: "serve", args: schema, run: (a) => a.port }), []))
          .result,
      ).toBe(8081);
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("reports paths and enforces unknown keys", () => {
    const schema = l.object(
      { count: l.number({ gte: 1 }), tags: l.array(l.enum(["a", "b"])) },
      { unknownKeys: "strict" },
    );
    const result = loculusAdapter.validate({ count: "0", tags: ["x"], extra: "x" }, schema);
    expect(result.success).toBe(false);
    if (!result.success)
      expect(result.errors.map((error) => error.path)).toEqual([
        ["count"],
        ["tags", "0"],
        ["extra"],
      ]);
  });
  it("extracts variants, unions, xor and intersections", () => {
    const a = l.object(
      { type: arg(l.literal("a"), { positional: true }), a: l.string() },
      { unknownKeys: "strict" },
    );
    const b = l.object(
      { type: arg(l.literal("b"), { positional: true }), b: l.string() },
      { unknownKeys: "strict" },
    );
    const variant = extractLoculusFields(
      l.discriminatedUnion("type", [a, b], { description: "Variants" }),
    );
    expect(variant.description).toBe("Variants");
    expect(variant.schemaType).toBe("discriminatedUnion");
    expect(variant.variants?.map((v) => v.discriminatorValue)).toEqual(["a", "b"]);
    expect(variant.unknownKeysMode).toBe("strict");
    const union = extractLoculusFields(l.union([a, b], { description: "Union" }));
    expect(union.unionOptions).toHaveLength(2);
    expect(union.description).toBe("Union");
    const xor = extractLoculusFields(l.xor([a, b], { description: "Exclusive" }));
    expect(xor.schemaType).toBe("xor");
    expect(xor.description).toBe("Exclusive");
    expect(
      extractLoculusFields(
        l.intersection(l.object({ a: l.string() }), l.object({ b: l.string() }), {
          description: "Combined",
        }),
      ).fields.map((f) => f.name),
    ).toEqual(["a", "b"]);
  });
  it("runs a discriminated command with branch-specific required fields", async () => {
    const command = defineCommand({
      name: "variant",
      args: l.discriminatedUnion("kind", [
        l.object({ kind: l.literal("a"), a: l.number() }),
        l.object({ kind: l.literal("b"), b: l.string() }),
      ]),
      run: (args) => (args.kind === "a" ? args.a : args.b),
    });
    expect((await runCommand(command, ["--kind", "a", "--a", "2"])).result).toBe(2);
    expect((await runCommand(command, ["--kind", "b", "--b", "hello"])).result).toBe("hello");
  });
  it("permits loose discriminator branch flags regardless of branch order", async () => {
    const strict = l.object({ kind: l.literal("a") }, { unknownKeys: "strict" });
    const loose = l.object({ kind: l.literal("b") }, { unknownKeys: "passthrough" });
    for (const options of [
      [strict, loose],
      [loose, strict],
    ] as const) {
      const command = defineCommand({
        name: "variant",
        args: l.discriminatedUnion("kind", options),
        run: (args) => args.kind,
      });
      const result = await runCommand(command, ["--kind", "b", "--extra"]);
      expect(result.success).toBe(true);
      expect(result.result).toBe("b");
    }
  });
  it("renders docs and shell completion with argument metadata", () => {
    const shape = {
      mode: arg(l.enum(["dev", "prod"], { description: "Mode" }), { alias: "m" }),
      cache: arg(l.boolean({ default: true, description: "Cache" }), { negation: true }),
    };
    const docs = renderArgsTable(shape);
    expect(docs).toContain("Mode");
    expect(docs).toContain("Cache");
    expect(docs).toContain("--mode");
    const command = defineCommand({ name: "app", args: l.object(shape), run: () => {} });
    for (const shell of ["bash", "zsh", "fish"] as const) {
      const script = generateCompletion(command, { shell, programName: "app" }).script;
      expect(script).toContain("mode");
      expect(script).toContain("prod");
      expect(script).toContain("no-cache");
    }
  });
  it("prompts using the same field validation and metadata", async () => {
    const s = l.object({ name: arg(l.string(), { prompt: { message: "Name" } }) });
    const prompt = vi.fn(async () => "world");
    const result = await promptMissingArgs({}, extractLoculusFields(s), {
      interactive: true,
      adapter: {
        text: prompt,
        password: prompt,
        confirm: async () => true,
        select: prompt,
        isCancelled: () => false,
      },
    });
    expect(result).toEqual({ name: "world" });
    expect(prompt).toHaveBeenCalled();
  });
  it("supports global args and JSON help", async () => {
    const define = createDefineCommand<{ verbose: boolean }>();
    const command = define({
      name: "app",
      args: l.object({ count: l.number() }),
      run: (args) => ({ count: args.count, verbose: args.verbose }),
    });
    expect(
      (
        await runCommand(command, ["--count", "3", "--verbose"], {
          globalArgs: l.object({ verbose: l.boolean({ default: false }) }),
        })
      ).result,
    ).toEqual({ count: 3, verbose: true });
    const flags = parseArgs(["--help-json"], command);
    expect(flags).toMatchObject({ helpJsonRequested: true });
  });
});
