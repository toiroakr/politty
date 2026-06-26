import { type } from "arktype";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { z } from "zod";

/**
 * The vendor entrypoints (`politty/zod`, `politty/valibot`,
 * `politty/standard-schema`) re-export the full politty API and register their
 * schema adapter on import. These tests import the entrypoints directly (rather
 * than relying on the shared test setup) to verify that contract.
 */
describe("vendor entrypoints", () => {
  it("politty/zod re-exports the API and runs a Zod command", async () => {
    const { defineCommand, runCommand, arg, extractFields } = await import("../src/zod.js");
    const schema = z.object({ count: arg(z.coerce.number(), { alias: "c" }) });
    expect(extractFields(schema).fields[0]?.alias).toEqual(["c"]);

    let seen: unknown;
    const cmd = defineCommand({ name: "z", args: schema, run: (a) => void (seen = a) });
    const result = await runCommand(cmd, ["--count", "3"]);
    expect(result.success).toBe(true);
    expect(seen).toMatchObject({ count: 3 });
  });

  it("politty/zod exposes the Zod-specific helpers", async () => {
    const { getUnknownKeysMode, extractEnumValues } = await import("../src/zod.js");
    expect(getUnknownKeysMode(z.strictObject({ a: z.string() }))).toBe("strict");
    expect(extractEnumValues(z.enum(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("politty/valibot re-exports the API and runs a Valibot command natively", async () => {
    const { defineCommand, runCommand, extractFields } = await import("../src/valibot.js");
    const schema = v.object({
      level: v.optional(v.picklist(["debug", "info"])),
      retries: v.optional(v.number(), 3),
    });
    const byName = Object.fromEntries(extractFields(schema).fields.map((f) => [f.name, f]));
    expect(byName.level?.enumValues).toEqual(["debug", "info"]);
    expect(byName.retries?.defaultValue).toBe(3);

    let seen: unknown;
    const cmd = defineCommand({ name: "v", args: schema, run: (a) => void (seen = a) });
    const result = await runCommand(cmd, ["--level", "info"]);
    expect(result.success).toBe(true);
    expect(seen).toMatchObject({ level: "info", retries: 3 });
  });

  it("politty/standard-schema runs an ArkType command via the generic adapter", async () => {
    const { defineCommand, runCommand } = await import("../src/standard-schema.js");
    let seen: unknown;
    const cmd = defineCommand({
      name: "a",
      args: type({ name: "string" }),
      run: (a) => void (seen = a),
    });
    const result = await runCommand(cmd, ["--name", "Bob"]);
    expect(result.success).toBe(true);
    expect(seen).toMatchObject({ name: "Bob" });
  });
});
