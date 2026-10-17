import { parseArgs } from "@politty/core/parser/arg-parser";
import * as l from "loculus";
import { describe, expect, it, vi } from "vitest";
import { extractLoculusFields, loculusAdapter } from "./adapter.js";
import { generateCompletion, parseCompletionContext } from "./completion.js";
import { renderArgsTable } from "./docs.js";
import { arg, createDefineCommand, defineCommand, generateHelpData, runCommand } from "./index.js";
import { promptMissingArgs } from "./prompt.js";

describe("@politty/loculus", () => {
  it("validates canonical numeric discriminators before boolean coercion in either branch order", async () => {
    const boolean = l.object({ mode: l.literal(true), flag: l.boolean() });
    const numeric = l.object({ mode: l.literal(1), count: l.number() });
    for (const options of [
      [boolean, numeric],
      [numeric, boolean],
    ] as const) {
      const command = defineCommand({
        name: "canonical",
        args: l.discriminatedUnion("mode", options),
        run: (value) => value,
      });
      expect((await runCommand(command, ["--mode", "1", "--count", "3"])).result).toEqual({
        mode: 1,
        count: 3,
      });
    }
  });
  it("keeps sibling named roles and aliases when a nested variant uses the same field positionally", async () => {
    const nested = l.discriminatedUnion("mode", [
      l.object({ mode: l.literal("a"), target: arg(l.string(), { positional: true }) }),
      l.object({ mode: l.literal("b"), count: l.number() }),
    ]);
    const command = defineCommand({
      name: "roles",
      args: l.union([
        nested,
        l.object({ mode: l.string(), target: arg(l.string(), { alias: "t" }) }),
      ]),
      run: (value) => value,
    });
    expect((await runCommand(command, ["--mode", "a", "--target", "hello"])).result).toEqual({
      mode: "a",
      target: "hello",
    });
    for (const option of ["--target", "-t"]) {
      const context = parseCompletionContext(["--mode", "a", option, ""], command);
      expect(context.completionType).toBe("option-value");
      expect(context.targetOption).toMatchObject({ name: "target", takesValue: true });
    }
  });
  it("keeps sibling union value completion when the nested discriminator branch does not fit", async () => {
    const nested = l.discriminatedUnion("mode", [
      l.object({ mode: l.literal("a"), flag: l.boolean() }),
      l.object({ mode: l.literal("b"), count: l.number() }),
    ]);
    const command = defineCommand({
      name: "sibling",
      args: l.union([nested, l.object({ mode: l.string(), payload: l.string() })]),
      run: (value) => value,
    });
    expect((await runCommand(command, ["--mode", "a", "--payload", "hello"])).result).toEqual({
      mode: "a",
      payload: "hello",
    });
    const context = parseCompletionContext(["--mode", "a", "--payload", ""], command);
    expect(context.completionType).toBe("option-value");
    expect(context.targetOption).toMatchObject({ name: "payload", takesValue: true });
    const flags = parseCompletionContext(["--mode", "a", "--pa"], command);
    expect(flags.options.some((option) => option.name === "payload")).toBe(true);
  });
  it("reads mixed boolean and string discriminators independently of branch order", async () => {
    const boolean = l.object({ mode: l.literal(true), flag: l.boolean() });
    const textual = l.object({ mode: l.literal("auto"), name: l.string() });
    for (const options of [
      [boolean, textual],
      [textual, boolean],
    ] as const) {
      const command = defineCommand({
        name: "mixed-layout",
        args: l.discriminatedUnion("mode", options),
        run: (value) => value,
      });
      expect((await runCommand(command, ["--mode", "auto", "--name", "app"])).result).toEqual({
        mode: "auto",
        name: "app",
      });
      expect((await runCommand(command, ["--mode", "true", "--flag"])).result).toEqual({
        mode: true,
        flag: true,
      });
      const context = parseCompletionContext(["--mode", "auto", "--name", ""], command);
      expect(context.targetOption).toMatchObject({ name: "name", takesValue: true });
    }
  });
  it("preserves transform and refine callbacks around composites with numeric discriminators", () => {
    const numeric = l.discriminatedUnion("edition", [
      l.object({ edition: l.literal(1), value: l.string() }),
      l.object({ edition: l.literal(2), value: l.string() }),
    ]);
    for (const composite of [
      l.union([numeric, l.object({ other: l.string() })]),
      l.xor([numeric, l.object({ other: l.string() })]),
      l.intersection(numeric, l.object({ edition: l.number(), value: l.string() })),
    ]) {
      const refine = vi.fn(
        (value: { value: string } | { other: string }) =>
          !("value" in value) || value.value !== "bad",
      );
      const transform = vi.fn((value) => ({ ...value, transformed: true }));
      const wrapped = l.transform(l.refine(composite, refine, "Bad value"), transform);
      for (const edition of ["2", "2.0", "2e0", "+2"]) {
        refine.mockClear();
        transform.mockClear();
        expect(loculusAdapter.validate({ edition, value: "hello" }, wrapped)).toMatchObject({
          success: true,
          data: { edition: 2, value: "hello", transformed: true },
        });
        expect(refine).toHaveBeenCalledOnce();
        expect(transform).toHaveBeenCalledOnce();
        refine.mockClear();
        transform.mockClear();
        expect(loculusAdapter.validate({ edition, value: "bad" }, wrapped).success).toBe(false);
        expect(refine).toHaveBeenCalledOnce();
        expect(transform).not.toHaveBeenCalled();
      }
    }
  });
  it("prompts for the selected numeric branch with alternate discriminator spellings", async () => {
    const args = l.discriminatedUnion("edition", [
      l.object({ edition: l.literal(1), flag: arg(l.boolean(), { prompt: { message: "Flag?" } }) }),
      l.object({ edition: l.literal(2), name: arg(l.string(), { prompt: { message: "Name?" } }) }),
    ]);
    const command = defineCommand({ name: "prompt-edition", args, run: (value) => value });
    const adapter = {
      text: vi.fn(async () => "Alice"),
      password: vi.fn(async () => "unused"),
      confirm: vi.fn(async () => true),
      select: vi.fn(async () => "unused"),
      isCancelled: () => false,
    };
    const outcome = await runCommand(command, ["--edition", "2.0"], {
      prompt: (raw, fields) => promptMissingArgs(raw, fields, { adapter, interactive: true }),
    });
    expect(outcome.result).toEqual({ edition: 2, name: "Alice" });
    expect(adapter.text).toHaveBeenCalledOnce();
    expect(adapter.confirm).not.toHaveBeenCalled();
  });
  it("narrows completion layouts inside ordinary union candidates", async () => {
    const nested = l.discriminatedUnion("edition", [
      l.object({ edition: l.literal(1), value: l.boolean() }),
      l.object({ edition: l.literal(2), value: l.string() }),
    ]);
    const command = defineCommand({
      name: "nested",
      args: l.union([nested, l.object({ other: l.string() })]),
      run: (value) => value,
    });
    expect((await runCommand(command, ["--edition", "2.0", "--value", "hello"])).result).toEqual({
      edition: 2,
      value: "hello",
    });
    const context = parseCompletionContext(["--edition", "2.0", "--value", ""], command);
    expect(context.completionType).toBe("option-value");
    expect(context.targetOption).toMatchObject({
      name: "value",
      valueType: "string",
      takesValue: true,
    });
  });
  it("rejects discriminator branches with indistinguishable CLI spellings", () => {
    const args = l.discriminatedUnion("edition", [
      l.object({ edition: l.literal(1), value: l.boolean() }),
      l.object({ edition: l.literal("1"), value: l.string() }),
    ]);
    expect(() => extractLoculusFields(args)).toThrow("Ambiguous CLI discriminator: edition=1");
  });
  it("selects the same argument and completion layout for alternate numeric spellings", async () => {
    const command = defineCommand({
      name: "edition",
      args: l.discriminatedUnion("edition", [
        l.object({ edition: l.literal(1), value: l.boolean() }),
        l.object({ edition: l.literal(2), value: l.string() }),
      ]),
      run: (args) => args,
    });
    for (const spelling of ["2", "2.0", "2e0", "+2"]) {
      expect(
        (await runCommand(command, ["--edition", spelling, "--value", "hello"])).result,
      ).toEqual({ edition: 2, value: "hello" });
      const context = parseCompletionContext(["--edition", spelling, "--value", ""], command);
      expect(context.completionType).toBe("option-value");
      expect(context.targetOption).toMatchObject({
        name: "value",
        takesValue: true,
        valueType: "string",
      });
    }
  });
  it("normalizes typed discriminators independently inside composite schemas", async () => {
    const numeric = l.discriminatedUnion("edition", [
      l.object({ edition: l.literal(1), value: l.string() }),
      l.object({ edition: l.literal(2), value: l.string() }),
    ]);
    const other = l.object({ other: l.string() });
    for (const args of [
      l.union([numeric, other]),
      l.xor([numeric, other]),
      l.intersection(
        numeric,
        l.object({ suffix: l.string({ default: "!" }) }, { unknownKeys: "strip" }),
      ),
    ]) {
      const command = defineCommand({ name: "composite", args, run: (values) => values });
      const outcome = await runCommand(command, ["--edition", "2.0", "--value", "hello"]);
      expect(outcome.success, outcome.error?.message).toBe(true);
      expect(outcome.result).toMatchObject({ edition: 2, value: "hello" });
    }
    const textual = l.discriminatedUnion("edition", [
      l.object({ edition: l.literal("2"), value: l.string() }),
      l.object({ edition: l.literal("other"), value: l.string() }),
    ]);
    expect(
      loculusAdapter.validate({ edition: "2", value: "hello" }, l.xor([numeric, textual])).success,
    ).toBe(false);
    expect(
      loculusAdapter.validate({ edition: "2", value: "hello" }, l.union([numeric, textual])),
    ).toMatchObject({ success: true, data: { edition: 2 } });
    const wrapped = l.transform(
      l.refine(numeric, (value) => value.value !== "bad", "Bad value"),
      (value) => ({ ...value, value: value.value.toUpperCase() }),
    );
    expect(loculusAdapter.validate({ edition: "2.0", value: "hello" }, wrapped)).toMatchObject({
      success: true,
      data: { edition: 2, value: "HELLO" },
    });
    expect(loculusAdapter.validate({ edition: "2.0", value: "bad" }, wrapped).success).toBe(false);
  });
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
  it("uses scalar wrapping for array environment fallbacks", async () => {
    vi.stubEnv("LOCULUS_TAGS", "a");
    try {
      const command = defineCommand({
        name: "serve",
        args: l.object({
          tags: arg(l.array(l.enum(["a", "b"]), { wrapScalar: true }), {
            env: "LOCULUS_TAGS",
          }),
        }),
        run: (args) => args.tags,
      });
      expect((await runCommand(command, [])).result).toEqual(["a"]);
      expect((await runCommand(command, ["--tags", "b"])).result).toEqual(["b"]);
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
  it("runs boolean and numeric literals with exact output types", async () => {
    const args = l.object({ confirm: l.literal(true), code: l.literal(42) });
    const command = defineCommand({
      name: "literal",
      args,
      run: (values) => {
        values.confirm satisfies true;
        values.code satisfies 42;
        return values;
      },
    });
    expect((await runCommand(command, ["--confirm", "--code", "42"])).result).toEqual({
      confirm: true,
      code: 42,
    });
    expect((await runCommand(command, ["--confirm=false", "--code", "42"])).success).toBe(false);
    expect((await runCommand(command, ["--confirm", "--code", "43"])).success).toBe(false);
    expect(generateHelpData(command).options).toEqual([
      expect.objectContaining({ name: "confirm", type: "boolean", enumValues: ["true"] }),
      expect.objectContaining({ name: "code", type: "number", enumValues: ["42"] }),
    ]);
    expect(renderArgsTable(args.shape)).toContain("`--confirm`");
    const completion = generateCompletion(command, {
      shell: "bash",
      programName: "literal",
    }).script;
    expect(completion).toContain("42");
  });
  it("runs typed discriminator branches and exposes their help metadata", async () => {
    const numeric = defineCommand({
      name: "numeric",
      args: l.discriminatedUnion("edition", [
        l.object({ edition: l.literal(1), name: l.string() }),
        l.object({ edition: l.literal(2), count: l.number() }),
      ]),
      run: (args) => args,
    });
    expect((await runCommand(numeric, ["--edition", "1", "--name", "app"])).result).toEqual({
      edition: 1,
      name: "app",
    });
    expect((await runCommand(numeric, ["--edition", "2", "--count", "3"])).result).toEqual({
      edition: 2,
      count: 3,
    });
    expect((await runCommand(numeric, ["--edition", "2"])).success).toBe(false);
    expect(generateHelpData(numeric).variants?.map((branch) => branch.discriminatorValue)).toEqual([
      "1",
      "2",
    ]);
    const boolean = defineCommand({
      name: "boolean",
      args: l.discriminatedUnion("enabled", [
        l.object({ enabled: l.literal(true), name: l.string() }),
        l.object({ enabled: l.literal(false), reason: l.string() }),
      ]),
      run: (args) => args,
    });
    expect((await runCommand(boolean, ["--enabled", "--name", "app"])).result).toEqual({
      enabled: true,
      name: "app",
    });
    expect(
      (await runCommand(boolean, ["--enabled=false", "--reason", "maintenance"])).result,
    ).toEqual({ enabled: false, reason: "maintenance" });
    expect(generateHelpData(boolean).variants?.map((branch) => branch.discriminatorValue)).toEqual([
      "true",
      "false",
    ]);
  });
  it("runs multi-value literals and preserves their output unions", async () => {
    const args = l.object({
      count: l.literal([1, 2, 3]),
      enabled: l.literal([true, false]),
      mode: l.literal([true, "auto"]),
    });
    const command = defineCommand({
      name: "choices",
      args,
      run: (values) => {
        values.count satisfies 1 | 2 | 3;
        values.enabled satisfies boolean;
        values.mode satisfies true | "auto";
        return values;
      },
    });
    expect(
      (await runCommand(command, ["--count", "2", "--enabled=false", "--mode", "auto"])).result,
    ).toEqual({ count: 2, enabled: false, mode: "auto" });
    expect(
      (await runCommand(command, ["--count", "1", "--enabled", "--mode", "true"])).result,
    ).toEqual({ count: 1, enabled: true, mode: true });
    expect(
      (await runCommand(command, ["--count", "4", "--enabled", "--mode", "auto"])).success,
    ).toBe(false);
    expect(generateHelpData(command).options).toEqual([
      expect.objectContaining({ name: "count", type: "number", enumValues: ["1", "2", "3"] }),
      expect.objectContaining({ name: "enabled", type: "boolean", enumValues: ["true", "false"] }),
      expect.objectContaining({ name: "mode", type: "unknown", enumValues: ["true", "auto"] }),
    ]);
    expect(renderArgsTable(args.shape)).toContain("`--mode <MODE>`");
  });
  it("runs mixed multi-value discriminator branches", async () => {
    const command = defineCommand({
      name: "mixed",
      args: l.discriminatedUnion("mode", [
        l.object({ mode: l.literal([1, "auto"]), name: l.string() }),
        l.object({ mode: l.literal([false, 2]), count: l.number() }),
      ]),
      run: (args) => args,
    });
    expect((await runCommand(command, ["--mode", "1", "--name", "app"])).result).toEqual({
      mode: 1,
      name: "app",
    });
    expect((await runCommand(command, ["--mode", "auto", "--name", "app"])).result).toEqual({
      mode: "auto",
      name: "app",
    });
    expect((await runCommand(command, ["--mode", "false", "--count", "3"])).result).toEqual({
      mode: false,
      count: 3,
    });
    expect((await runCommand(command, ["--mode", "2", "--count", "3"])).result).toEqual({
      mode: 2,
      count: 3,
    });
    expect((await runCommand(command, ["--mode", "2"])).success).toBe(false);
    expect(generateHelpData(command).variants?.map((branch) => branch.discriminatorValue)).toEqual([
      "1",
      "auto",
      "false",
      "2",
    ]);
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

  it("expands nested object fields into options and nests their values", async () => {
    const command = defineCommand({
      name: "serve",
      args: l.object({
        config: arg(
          l.object(
            {
              serverPort: l.number(),
              host: l.string({ default: "localhost" }),
            },
            { optional: true },
          ),
          { flatten: "kebab" },
        ),
        db: l.object(
          { url: l.string(), pool: l.number() },
          { default: { undefined: { url: "x", pool: 1 } } },
        ),
      }),
      run: (args) => args,
    });

    expect(
      (await runCommand(command, ["--config-server-port", "80", "--db.pool", "5"])).result,
    ).toEqual({ config: { serverPort: 80, host: "localhost" }, db: { url: "x", pool: 5 } });
    expect((await runCommand(command, [])).result).toEqual({ db: { url: "x", pool: 1 } });
  });

  it("keeps nested properties of both intersection members", async () => {
    const command = defineCommand({
      name: "serve",
      // Loculus intersections validate each member on its own, so the nested
      // objects have to pass the other member's keys through.
      args: l.intersection(
        l.object({ config: l.object({ host: l.string() }, { unknownKeys: "passthrough" }) }),
        l.object({ config: l.object({ port: l.string() }, { unknownKeys: "passthrough" }) }),
      ),
      run: (args) => args.config,
    });
    const result = await runCommand(command, ["--config.host", "h", "--config.port", "1"]);
    expect(result.result).toEqual({ host: "h", port: "1" });
  });
});
