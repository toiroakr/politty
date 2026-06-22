import { type } from "arktype";
import * as v from "valibot";
import { beforeAll, describe, expect, it } from "vitest";
import { prepareSchema } from "../src/core/standard-schema.js";
import { arg, defineCommand, extractFields, runCommand } from "../src/index.js";

/**
 * Standard Schema support: politty introspects non-Zod schema libraries
 * (Valibot, ArkType) by converting them to JSON Schema, while metadata
 * registered via `arg()` is recovered from the original schema by reference.
 */
describe("Standard Schema support", () => {
  describe("Valibot", () => {
    const schema = v.object({
      name: arg(v.pipe(v.string(), v.description("the name")), { positional: true, alias: "n" }),
      count: arg(v.optional(v.pipe(v.string(), v.transform(Number), v.number())), {
        description: "how many",
      }),
      retries: v.optional(v.number(), 3),
      loud: arg(v.optional(v.boolean(), false), { alias: "l" }),
      level: v.optional(v.picklist(["debug", "info", "warn"])),
    });

    beforeAll(async () => {
      await prepareSchema(schema);
    });

    it("extracts fields with types, required, defaults, enums", () => {
      const fields = extractFields(schema).fields;
      const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

      expect(byName.name?.type).toBe("string");
      expect(byName.name?.required).toBe(true);
      expect(byName.name?.positional).toBe(true);
      expect(byName.name?.alias).toEqual(["n"]);
      expect(byName.name?.description).toBe("the name");

      expect(byName.count?.type).toBe("number");
      expect(byName.count?.required).toBe(false);
      expect(byName.count?.description).toBe("how many");

      expect(byName.retries?.type).toBe("number");
      expect(byName.retries?.required).toBe(false);
      expect(byName.retries?.defaultValue).toBe(3);

      expect(byName.loud?.type).toBe("boolean");
      expect(byName.loud?.alias).toEqual(["l"]);

      expect(byName.level?.enumValues).toEqual(["debug", "info", "warn"]);
    });

    it("runs with parsed + coerced + aliased arguments", async () => {
      const seen: Record<string, unknown>[] = [];
      const cmd = defineCommand({
        name: "v",
        args: schema,
        run: (args) => {
          seen.push({ ...args });
        },
      });

      const result = await runCommand(cmd, ["Alice", "--count", "3", "-l", "--level", "info"]);
      expect(result.success).toBe(true);
      expect(seen[0]).toMatchObject({
        name: "Alice",
        count: 3,
        retries: 3,
        loud: true,
        level: "info",
      });
      expect(typeof seen[0]?.count).toBe("number");
    });

    it("reports validation errors via ~standard.validate", async () => {
      const cmd = defineCommand({
        name: "v",
        args: v.object({ count: v.pipe(v.string(), v.transform(Number), v.number()) }),
        run: () => {},
      });
      const result = await runCommand(cmd, []);
      expect(result.success).toBe(false);
      expect(result.success ? "" : result.error?.message).toContain("count");
    });
  });

  describe("ArkType", () => {
    const schema = type({
      name: "string",
      "count?": "string.numeric.parse",
      "level?": "'debug' | 'info' | 'warn'",
    });

    beforeAll(async () => {
      await prepareSchema(schema);
    });

    it("extracts fields including enums and optionality", () => {
      const fields = extractFields(schema).fields;
      const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

      expect(byName.name?.type).toBe("string");
      expect(byName.name?.required).toBe(true);

      // coercion morph falls back to its string input type
      expect(byName.count?.type).toBe("string");
      expect(byName.count?.required).toBe(false);

      expect(byName.level?.enumValues).toEqual(["debug", "info", "warn"]);
    });

    it("runs with parsed + coerced arguments", async () => {
      const seen: Record<string, unknown>[] = [];
      const cmd = defineCommand({
        name: "a",
        args: schema,
        run: (args) => {
          seen.push({ ...args });
        },
      });

      const result = await runCommand(cmd, ["--name", "Bob", "--count", "5", "--level", "debug"]);
      expect(result.success).toBe(true);
      expect(seen[0]).toMatchObject({ name: "Bob", count: 5, level: "debug" });
      expect(typeof seen[0]?.count).toBe("number");
    });

    it("recovers arg() metadata by reference", async () => {
      const nameType = type("string");
      const argSchema = type({ value: nameType });
      // arg() keyed on the same Type reference exposed by `.get()`
      arg(nameType, { alias: "V", description: "the value" });
      await prepareSchema(argSchema);

      const field = extractFields(argSchema).fields.find((f) => f.name === "value");
      expect(field?.alias).toEqual(["V"]);
      expect(field?.description).toBe("the value");
    });

    it("reports validation errors for missing required fields", async () => {
      const cmd = defineCommand({ name: "a", args: schema, run: () => {} });
      const result = await runCommand(cmd, []);
      expect(result.success).toBe(false);
    });
  });

  describe("composite schemas", () => {
    it("extracts a Valibot variant as a discriminated union", async () => {
      const schema = v.variant("kind", [
        v.object({
          kind: v.literal("add"),
          path: arg(v.string(), { description: "file to add", alias: "p" }),
        }),
        v.object({ kind: v.literal("remove"), force: v.optional(v.boolean(), false) }),
      ]);
      await prepareSchema(schema);
      const extracted = extractFields(schema);

      expect(extracted.schemaType).toBe("discriminatedUnion");
      expect(extracted.discriminator).toBe("kind");
      // Merged unique fields across variants.
      expect(extracted.fields.map((f) => f.name).sort()).toEqual(["force", "kind", "path"]);

      const variantValues = extracted.variants?.map((variant) => variant.discriminatorValue);
      expect(variantValues).toEqual(["add", "remove"]);

      // arg() metadata is recovered by reference inside the variant branch.
      const addVariant = extracted.variants?.find(
        (variant) => variant.discriminatorValue === "add",
      );
      const pathField = addVariant?.fields.find((f) => f.name === "path");
      expect(pathField?.description).toBe("file to add");
      expect(pathField?.alias).toEqual(["p"]);
    });

    it("extracts a Valibot union (no discriminator) with union options", async () => {
      const schema = v.union([
        v.object({ foo: v.string() }),
        v.object({ bar: v.optional(v.number()) }),
      ]);
      await prepareSchema(schema);
      const extracted = extractFields(schema);

      expect(extracted.schemaType).toBe("union");
      expect(extracted.discriminator).toBeUndefined();
      expect(extracted.unionOptions?.map((option) => option.fields.map((f) => f.name))).toEqual([
        ["foo"],
        ["bar"],
      ]);
      expect(extracted.fields.map((f) => f.name).sort()).toEqual(["bar", "foo"]);
    });

    it("extracts a Valibot intersection with merged fields", async () => {
      const schema = v.intersect([
        v.object({ foo: arg(v.string(), { description: "the foo" }) }),
        v.object({ bar: v.optional(v.number()) }),
      ]);
      await prepareSchema(schema);
      const extracted = extractFields(schema);

      expect(extracted.schemaType).toBe("intersection");
      expect(extracted.fields.map((f) => f.name).sort()).toEqual(["bar", "foo"]);
      const fooField = extracted.fields.find((f) => f.name === "foo");
      expect(fooField?.description).toBe("the foo");
    });

    it("detects an ArkType discriminated union from anyOf", async () => {
      const schema = type({ kind: "'add'", path: "string" }).or({
        kind: "'remove'",
        force: "boolean",
      });
      await prepareSchema(schema);
      const extracted = extractFields(schema);

      expect(extracted.schemaType).toBe("discriminatedUnion");
      expect(extracted.discriminator).toBe("kind");
      expect(extracted.variants?.map((variant) => variant.discriminatorValue).sort()).toEqual([
        "add",
        "remove",
      ]);
    });

    it("runs a command whose args are a Valibot variant", async () => {
      const seen: Record<string, unknown>[] = [];
      const schema = v.variant("kind", [
        v.object({ kind: v.literal("add"), path: arg(v.string(), { positional: true }) }),
        v.object({ kind: v.literal("remove"), force: v.optional(v.boolean(), false) }),
      ]);
      const cmd = defineCommand({
        name: "c",
        args: schema,
        run: (args) => {
          seen.push({ ...(args as Record<string, unknown>) });
        },
      });

      const ok = await runCommand(cmd, ["--kind", "add", "file.txt"]);
      expect(ok.success).toBe(true);
      expect(seen[0]).toMatchObject({ kind: "add", path: "file.txt" });

      // Validation still flows through ~standard.validate: a value violating the
      // active variant is rejected.
      const bad = await runCommand(cmd, ["--kind", "add"]);
      expect(bad.success).toBe(false);
    });
  });
});
