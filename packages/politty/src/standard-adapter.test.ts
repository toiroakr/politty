import type { SchemaLike } from "@politty/core";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { standardAdapter, standardArgs, type StandardArgsSchema } from "./standard-adapter.js";

function withInput(input: Record<string, unknown>) {
  return {
    "~standard": { version: 1 as const, jsonSchema: { input: () => input } },
  };
}

describe("Standard JSON Schema adapter", () => {
  it("extracts requiredness, nullable fields, and annotations from the input", () => {
    const schema = standardArgs(z.object({ name: z.string(), count: z.number().optional() }), {
      jsonSchema: withInput({
        type: "object",
        description: "Search options",
        required: ["name"],
        properties: {
          name: { type: "string", description: "User name" },
          count: { anyOf: [{ type: "integer", default: 0 }, { type: "null" }] },
        },
      }),
      fields: { name: { alias: "n", description: "Name to search" } },
    });

    expect(standardAdapter.extractFields(schema)).toMatchObject({
      schemaType: "object",
      description: "Search options",
      fields: [
        {
          name: "name",
          type: "string",
          required: true,
          alias: ["n"],
          description: "Name to search",
        },
        { name: "count", type: "number", required: false, defaultValue: 0 },
      ],
    });
  });

  it("resolves JSON Pointer escapes and retains annotations on the referring field", () => {
    const schema = standardArgs(z.object({ mode: z.enum(["fast", "safe"]) }), {
      jsonSchema: withInput({
        type: "object",
        properties: { mode: { $ref: "#/$defs/mode~1~0%20name", description: "Search strategy" } },
        $defs: { "mode/~ name": { enum: ["fast", "safe"], description: "Shared metadata" } },
      }),
    });

    expect(standardAdapter.extractFields(schema).fields).toMatchObject([
      {
        name: "mode",
        type: "string",
        enumValues: ["fast", "safe"],
        description: "Search strategy",
      },
    ]);
  });

  it("extracts tagged branches and their own required options from oneOf", () => {
    const schema = z.discriminatedUnion("operation", [
      z.strictObject({ operation: z.literal("read"), path: z.string() }).describe("Read a file"),
      z.strictObject({ operation: z.literal("write"), overwrite: z.boolean().optional() }),
    ]);
    const extracted = standardAdapter.extractFields(schema);

    expect(extracted).toMatchObject({
      schemaType: "discriminatedUnion",
      discriminator: "operation",
      unknownKeysMode: "strict",
      fields: [
        { name: "operation", enumValues: ["read", "write"] },
        { name: "path", required: true },
        { name: "overwrite", required: false },
      ],
      variants: [
        {
          discriminatorValue: "read",
          description: "Read a file",
          fields: [{ name: "operation" }, { name: "path", required: true }],
        },
        {
          discriminatorValue: "write",
          fields: [{ name: "operation" }, { name: "overwrite", required: false }],
        },
      ],
    });
  });

  it("caches extraction per configured schema and keeps metadata independent", () => {
    const schema = z.object({ force: z.boolean() });
    const input = vi.fn(() => ({
      type: "object",
      properties: { force: { type: "boolean" } },
      required: ["force"],
    }));
    const jsonSchema = { "~standard": { version: 1 as const, jsonSchema: { input } } };
    const first = standardArgs(schema, { jsonSchema, fields: { force: { alias: "f" } } });
    const second = standardArgs(schema, { jsonSchema, fields: { force: { alias: "F" } } });

    expect(standardAdapter.extractFields(first).fields[0]?.alias).toEqual(["f"]);
    expect(standardAdapter.getUnknownKeysMode(first)).toBe("strip");
    expect(standardAdapter.extractFields(second).fields[0]?.alias).toEqual(["F"]);
    expect(input.mock.calls).toEqual([
      [{ target: "draft-2020-12" }],
      [{ target: "draft-2020-12" }],
    ]);
  });

  it.each([
    { input: { type: "string" }, error: "object shape" },
    { input: { allOf: [{ type: "object" }, { type: "string" }] }, error: "object shape" },
    {
      input: { anyOf: [{ type: "object" }], allOf: [{ type: "object" }] },
      error: "single object composition",
    },
    { input: { $ref: "#/$defs/missing" }, error: "cannot resolve JSON Schema reference" },
    { input: { $ref: "#" }, error: "cannot inspect JSON Schema reference" },
  ])("reports unsupported input schemas ($error)", ({ input, error }) => {
    const schema = standardArgs(z.object({}), { jsonSchema: withInput(input) });
    expect(() => standardAdapter.extractFields(schema)).toThrow(error);
  });

  it("rejects CLI metadata for fields absent from the converted input", () => {
    const schema = standardArgs(z.object({ hidden: z.string() }), {
      jsonSchema: withInput({ type: "object" }),
      fields: { hidden: { alias: "x" } },
    });
    expect(() => standardAdapter.extractFields(schema)).toThrow('unknown argument "hidden"');
  });

  it("preserves the receiver when calling the supplied converter and validator", () => {
    const input = { type: "object", properties: { name: { type: "string" } } };
    const converter = {
      "~standard": {
        version: 1 as const,
        jsonSchema: {
          shape: input,
          input() {
            return this.shape;
          },
        },
      },
    };
    const validator: SchemaLike<{ name: string }> & { "~standard": { trimmedName: string } } = {
      "~standard": {
        version: 1 as const,
        vendor: "fixture",
        trimmedName: "Ada",
        validate() {
          return { value: { name: this.trimmedName } };
        },
      },
    };
    const schema = standardArgs(validator, { jsonSchema: converter });
    expect(standardAdapter.extractFields(schema).fields).toMatchObject([{ name: "name" }]);
    expect(standardAdapter.validate({ name: " Ada " }, schema)).toEqual({
      success: true,
      data: { name: "Ada" },
    });
  });

  it("reports converter failures with the original cause", () => {
    const cause = new Error("no representation");
    const schema: StandardArgsSchema = {
      "~standard": {
        version: 1,
        vendor: "fixture",
        jsonSchema: {
          input: () => {
            throw cause;
          },
        },
        validate: (value) => ({ value }),
      },
    };

    expect(() => standardAdapter.extractFields(schema)).toThrow(
      expect.objectContaining({ cause, message: expect.stringContaining("draft-2020-12") }),
    );
  });

  it("preserves Standard Schema issue paths, including index and object segments", () => {
    const schema: StandardArgsSchema = {
      "~standard": {
        version: 1,
        vendor: "fixture",
        jsonSchema: { input: () => ({ type: "object" }) },
        validate: () => ({
          issues: [
            { message: "Invalid item", path: ["files", 0, { key: "name" }] },
            { message: "Invalid arguments" },
          ],
        }),
      },
    };

    expect(standardAdapter.validate({}, schema)).toEqual({
      success: false,
      errors: [
        { message: "Invalid item", path: ["files", "0", "name"], code: "custom" },
        { message: "Invalid arguments", path: [], code: "custom" },
      ],
    });
  });

  it("rejects asynchronous validation", () => {
    const schema: StandardArgsSchema = {
      "~standard": {
        version: 1,
        vendor: "fixture",
        jsonSchema: { input: () => ({ type: "object" }) },
        validate: async (value) => ({ value }),
      },
    };
    expect(() => standardAdapter.validate({}, schema)).toThrow("requires a synchronous");
  });
});
