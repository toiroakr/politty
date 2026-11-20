import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { z } from "zod";
import { renderArgsTable } from "./standard-docs.js";
import {
  arg,
  defineCommand,
  extractFields,
  generateHelpData,
  runCommand,
  standardArgs,
  standardField,
  unflatten,
} from "./standard.js";

function inputSchema(document: Record<string, unknown>) {
  return {
    "~standard": { version: 1 as const, jsonSchema: { input: () => document } },
  };
}

describe("Standard JSON Schema composite command arguments", () => {
  it("routes a plain union by its fields and retains the validator output", async () => {
    const schema = z.union([z.object({ file: z.string() }), z.object({ url: z.string().url() })]);
    const command = defineCommand({
      name: "load",
      args: schema,
      run: (args) => ("file" in args ? args.file : args.url),
    });
    expect(extractFields(schema)).toMatchObject({
      schemaType: "union",
      unionOptions: [
        { fields: [{ name: "file", required: true }] },
        { fields: [{ name: "url", required: true }] },
      ],
    });
    expect(generateHelpData(command).unionOptions).toHaveLength(2);
    expect(await runCommand(command, ["--file", "index.ts"])).toMatchObject({ result: "index.ts" });
    expect(await runCommand(command, ["--url", "https://example.com"])).toMatchObject({
      result: "https://example.com",
    });
    expect(await runCommand(command, ["--url", "invalid"])).toMatchObject({ success: false });
  });

  it("routes exclusive oneOf alternatives with the original validator", async () => {
    const source = z.xor([z.object({ url: z.string() }), z.object({ file: z.string() })]);
    const command = defineCommand({ name: "read", args: source, run: (args) => ({ ...args }) });
    expect(extractFields(source).schemaType).toBe("xor");
    expect(await runCommand(command, ["--file", "notes.txt"])).toMatchObject({
      success: true,
      result: { file: "notes.txt" },
    });
    expect(await runCommand(command, ["--file", "notes.txt", "--url", "remote"])).toMatchObject({
      success: false,
    });
  });

  it("uses explicit branch validators for effects on otherwise identical CLI shapes", async () => {
    const dev = z.object({ profile: z.string().refine((value) => value.startsWith("dev")) });
    const prod = z.object({ profile: z.string().refine((value) => value.startsWith("prod")) });
    const devEffect = vi.fn();
    const prodEffect = vi.fn();
    const command = defineCommand({
      name: "deploy",
      args: standardArgs(z.union([dev, prod]), {
        branches: [
          standardArgs(dev, { fields: { profile: { effect: devEffect } } }),
          standardArgs(prod, { fields: { profile: { effect: prodEffect } } }),
        ],
      }),
      run: ({ profile }) => profile,
    });
    expect(await runCommand(command, ["--profile", "prod-east"])).toMatchObject({
      success: true,
      result: "prod-east",
    });
    expect(devEffect).not.toHaveBeenCalled();
    expect(prodEffect).toHaveBeenCalledWith("prod-east", expect.any(Object));
  });

  it("rejects branch-dependent effects when no branch validators were supplied", () => {
    const schema = standardArgs(
      z.union([z.object({ file: z.string() }), z.object({ url: z.string() })]),
      {
        fields: { file: { effect: () => {} } },
      },
    );
    expect(() => extractFields(schema)).toThrow("requires branch validators");
  });

  it("routes numeric tags and preserves per-branch hooks", async () => {
    const legacy = z.object({ edition: z.literal(1), path: z.string() });
    const current = z.object({ edition: z.literal(2), path: z.string() });
    const legacyEffect = vi.fn();
    const currentEffect = vi.fn();
    const command = defineCommand({
      name: "migrate",
      args: standardArgs(z.discriminatedUnion("edition", [legacy, current]), {
        discriminator: "edition",
        branches: [
          standardArgs(legacy, { fields: { path: { effect: legacyEffect } } }),
          standardArgs(current, { fields: { path: { effect: currentEffect } } }),
        ],
      }),
      run: ({ edition, path }) => ({ edition, path }),
    });
    expect(await runCommand(command, ["--edition", "2e0", "--path", "config.json"])).toMatchObject({
      success: true,
      result: { edition: 2, path: "config.json" },
    });
    expect(legacyEffect).not.toHaveBeenCalled();
    expect(currentEffect).toHaveBeenCalledWith("config.json", expect.any(Object));
    expect(generateHelpData(command).options[0]).toMatchObject({ enumValues: ["1", "2"] });
  });

  it.each(["anyOf", "oneOf"] as const)(
    "reads typed tag literals from %s references",
    async (key) => {
      const validator = z.discriminatedUnion("edition", [
        z.object({ edition: z.literal([1, 2]) }),
        z.object({ edition: z.literal(3) }),
      ]);
      const command = defineCommand({
        name: "migrate",
        args: standardArgs(validator, {
          discriminator: "edition",
          jsonSchema: {
            "~standard": {
              version: 1,
              jsonSchema: {
                input: () => ({
                  $defs: { first: { const: 1 }, second: { const: 2 } },
                  anyOf: [
                    {
                      type: "object",
                      properties: {
                        edition: {
                          [key]: [{ $ref: "#/$defs/first" }, { $ref: "#/$defs/second" }],
                        },
                      },
                      required: ["edition"],
                    },
                    {
                      type: "object",
                      properties: { edition: { const: 3 } },
                      required: ["edition"],
                    },
                  ],
                }),
              },
            },
          },
        }),
        run: ({ edition }) => edition,
      });
      expect(await runCommand(command, ["--edition", "2"])).toMatchObject({
        success: true,
        result: 2,
      });
    },
  );

  it("normalizes a numeric discriminator in a nested union", async () => {
    const tagged = z.discriminatedUnion("edition", [
      z.object({ edition: z.literal(1), path: z.string() }),
      z.object({ edition: z.literal(2), path: z.string() }),
    ]);
    const command = defineCommand({
      name: "migrate",
      args: z.union([tagged, z.object({ edition: z.string(), remote: z.string() })]),
      run: (args) => args,
    });
    expect(await runCommand(command, ["--edition", "2", "--path", "config.json"])).toMatchObject({
      success: true,
      result: { edition: 2, path: "config.json" },
    });
    expect(await runCommand(command, ["--edition", "2", "--remote", "demo"])).toMatchObject({
      success: true,
      result: { edition: "2", remote: "demo" },
    });
  });

  it("uses required names declared alongside the union when identifying tags", async () => {
    const validator = z.discriminatedUnion("edition", [
      z.object({ edition: z.literal(1), path: z.string() }),
      z.object({ edition: z.literal(2), verbose: z.boolean().optional() }),
    ]);
    const command = defineCommand({
      name: "migrate",
      args: standardArgs(validator, {
        jsonSchema: inputSchema({
          required: ["edition"],
          anyOf: [
            {
              type: "object",
              properties: { edition: { const: 1 }, path: { type: "string" } },
              required: ["path"],
            },
            {
              type: "object",
              properties: { edition: { const: 2 }, verbose: { type: "boolean" } },
            },
          ],
        }),
      }),
      run: (value) => value,
    });
    expect(await runCommand(command, ["--edition", "2"])).toMatchObject({
      success: true,
      result: { edition: 2 },
    });
  });

  it("retains array item choices from an allOf operand without an explicit type", () => {
    const command = defineCommand({
      name: "search",
      args: standardArgs(z.object({ modes: z.array(z.enum(["fast", "safe"])) }), {
        jsonSchema: inputSchema({
          type: "object",
          properties: {
            modes: { allOf: [{ type: "array" }, { items: { enum: ["fast", "safe"] } }] },
          },
          required: ["modes"],
        }),
      }),
      run: ({ modes }) => modes,
    });
    expect(generateHelpData(command).options[0]).toMatchObject({
      enumValues: ["fast", "safe"],
    });
  });

  it("keeps an effect registered on a later intersection operand", async () => {
    const first = z.object({ path: z.string() });
    const second = z.object({ path: z.string().min(1) });
    const effect = vi.fn();
    const command = defineCommand({
      name: "read",
      args: standardArgs(z.intersection(first, second), {
        branches: [first, standardArgs(second, { fields: { path: { effect } } })],
        jsonSchema: inputSchema({
          allOf: [
            { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
            { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
          ],
        }),
      }),
      run: ({ path }) => path,
    });
    expect(await runCommand(command, ["--path", "notes.txt"])).toMatchObject({ success: true });
    expect(effect).toHaveBeenCalledWith("notes.txt", expect.any(Object));
  });

  it("rejects conflicting effects for the same intersection field", () => {
    const first = z.object({ path: z.string() });
    const second = z.object({ path: z.string().min(1) });
    const object = { type: "object", properties: { path: { type: "string" } } };
    const args = standardArgs(z.intersection(first, second), {
      branches: [
        standardArgs(first, { fields: { path: { effect: vi.fn() } } }),
        standardArgs(second, { fields: { path: { effect: vi.fn() } } }),
      ],
      jsonSchema: inputSchema({ allOf: [object, object] }),
    });
    expect(() => extractFields(args)).toThrow('multiple effects for "path"');
  });

  it("passes unknown flags allowed by a nested allOf pattern to the validator", async () => {
    const command = defineCommand({
      name: "mark",
      args: standardArgs(z.looseObject({ label: z.string() }), {
        jsonSchema: inputSchema({
          unevaluatedProperties: false,
          allOf: [
            { type: "object", properties: { label: { type: "string" } }, required: ["label"] },
            {
              allOf: [{ $ref: "#/$defs/extra" }],
            },
          ],
          $defs: { extra: { type: "object", patternProperties: { "^x-": { type: "string" } } } },
        }),
      }),
      run: (value) => value["x-color"],
    });
    expect(await runCommand(command, ["--label", "demo", "--x-color", "blue"])).toMatchObject({
      success: true,
      result: "blue",
    });
  });

  it("uses explicit discriminator values when a converter omits the tags", async () => {
    const schema = z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("send"), path: z.string() }),
      z.object({ kind: z.literal("receive"), wait: z.boolean() }),
    ]);
    const args = standardArgs(schema, {
      discriminator: { field: "kind", values: ["send", "receive"] },
      jsonSchema: {
        "~standard": {
          version: 1,
          jsonSchema: {
            input: () => ({
              anyOf: [
                {
                  type: "object",
                  properties: { kind: { type: "string" }, path: { type: "string" } },
                  required: ["kind", "path"],
                },
                {
                  type: "object",
                  properties: { kind: { type: "string" }, wait: { type: "boolean" } },
                  required: ["kind", "wait"],
                },
              ],
            }),
          },
        },
      },
    });
    const command = defineCommand({ name: "transfer", args, run: (args) => ({ ...args }) });
    expect(await runCommand(command, ["--wait", "--kind", "receive"])).toMatchObject({
      success: true,
      result: { kind: "receive", wait: true },
    });
    expect(
      generateHelpData(command).variants?.map((variant) => variant.discriminatorValue),
    ).toEqual(["send", "receive"]);
  });

  it("merges intersection fields and keeps requiredness from either operand", async () => {
    const left = z.object({
      region: z.enum(["eu", "us"]).optional(),
      verbose: z.boolean().default(false),
    });
    const right = z.object({ region: z.literal("eu"), target: z.string() });
    const validator = z.intersection(left, right);
    const schema = standardArgs(validator, {
      jsonSchema: {
        "~standard": {
          version: 1,
          jsonSchema: {
            input: ({ target }) => ({
              allOf: [left, right].map((branch) => z.toJSONSchema(branch, { io: "input", target })),
            }),
          },
        },
      },
    });
    expect(extractFields(validator).fields[0]).toMatchObject({
      name: "region",
      enumValues: ["eu"],
    });
    const command = defineCommand({ name: "ship", args: schema, run: (args) => ({ ...args }) });
    expect(extractFields(schema)).toMatchObject({
      schemaType: "intersection",
      fields: [
        { name: "region", required: true, enumValues: ["eu"] },
        { name: "verbose", required: false },
        { name: "target", required: true },
      ],
    });
    expect(
      await runCommand(command, ["--region", "eu", "--target", "prod", "--verbose"]),
    ).toMatchObject({
      success: true,
      result: { region: "eu", target: "prod", verbose: true },
    });
    expect(await runCommand(command, ["--region", "us", "--target", "prod"])).toMatchObject({
      success: false,
    });
  });
});

describe("Standard JSON Schema metadata", () => {
  it("uses field handles and explicit parser metadata with opaque input fragments", async () => {
    const label = arg(z.string(), { alias: "n" });
    const schema = standardArgs(z.object({ label, enabled: z.boolean().default(false) }), {
      fields: { label, enabled: { type: "boolean", alias: "e", negation: true } },
      jsonSchema: {
        "~standard": {
          version: 1,
          jsonSchema: {
            input: () => ({
              type: "object",
              properties: { label: {}, enabled: {} },
              required: ["label"],
            }),
          },
        },
      },
    });
    const command = defineCommand({
      name: "mark",
      args: schema,
      run: ({ label, enabled }) => [label, enabled],
    });
    expect(await runCommand(command, ["-n", "demo", "-e"])).toMatchObject({
      success: true,
      result: ["demo", true],
    });
  });

  it("renders explicitly documented standalone fields with their requiredness", () => {
    const argument = standardField(arg(z.string().describe("Access token"), { alias: "t" }), {
      required: true,
    });
    expect(renderArgsTable({ token: argument })).toMatch(/--token.*-t.*Access token.*Yes/);
  });

  it("uses explicit requiredness when a documented field is linked to a command schema", () => {
    const token = z.string().optional();
    const command = defineCommand({
      name: "authenticate",
      args: standardArgs(z.object({ token }), {
        fields: { token: standardField(token, { required: true }) },
      }),
      run: ({ token }) => token,
    });
    expect(generateHelpData(command).options[0]).toMatchObject({ name: "token", required: true });
  });

  it("supports camelCase and kebab-case unflatten prefixes", async () => {
    const camel = defineCommand({
      name: "connect",
      args: unflatten(z.object({ serverPort: z.coerce.number() }), {
        style: "camel",
        prefixes: ["server"],
      }),
      run: ({ server }) => server.port,
    });
    const kebab = defineCommand({
      name: "connect",
      args: unflatten(z.object({ "server-port": z.coerce.number() }), {
        style: "kebab",
        prefixes: ["server"],
      }),
      run: ({ server }) => server.port,
    });
    expect(await runCommand(camel, ["--server-port", "3000"])).toMatchObject({
      success: true,
      result: 3000,
    });
    expect(await runCommand(kebab, ["--server-port", "4000"])).toMatchObject({
      success: true,
      result: 4000,
    });
  });

  it("nests validated output while keeping CLI metadata and flat issue paths", async () => {
    const portEffect = vi.fn();
    const schema = unflatten(
      standardArgs(
        z.object({
          "db.host": z.string().default("localhost"),
          "db.port": z.coerce.number().positive(),
        }),
        { fields: { "db.port": { alias: "p", effect: portEffect } } },
      ),
    );
    const command = defineCommand({
      name: "connect",
      args: schema,
      run: (args) => {
        expectTypeOf(args.db.port).toEqualTypeOf<number>();
        return { db: args.db, source: args.$source?.("db.port") };
      },
    });
    expect(await runCommand(command, ["-p", "5432"])).toMatchObject({
      success: true,
      result: { db: { host: "localhost", port: 5432 }, source: "cli" },
    });
    expect(portEffect).toHaveBeenCalledWith(5432, expect.any(Object));
    expect(await runCommand(command, ["-p", "-1"])).toMatchObject({
      success: false,
      error: { message: expect.stringContaining("db.port") },
    });
    expect(() => unflatten(z.object({ db: z.string(), "db.port": z.string() }))).toThrow(
      "both a value and a group",
    );
  });
});
