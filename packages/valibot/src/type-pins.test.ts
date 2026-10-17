/**
 * Type-level pins: `@politty/valibot`'s schema-taking API must reject
 * schemas from other Standard Schema libraries (they would type-check
 * against core's structural constraint but fail at runtime in the valibot
 * adapter). Verified by vitest's typecheck pass via `@ts-expect-error`.
 */

import type { SchemaLike } from "@politty/core";
import * as v from "valibot";
import { describe, expect, it } from "vitest";
import { arg, defineCommand } from "./index.js";

// A structurally valid Standard Schema that is NOT a valibot schema (shaped
// like what another library such as zod would produce).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const foreignSchema = {
  "~standard": { version: 1, vendor: "not-valibot", validate: (value: unknown) => value },
} as unknown as SchemaLike<Record<string, any>>;

describe("@politty/valibot type pins", () => {
  it("accepts valibot schemas and rejects foreign standard schemas", () => {
    const cmd = defineCommand({
      name: "ok",
      args: v.variant("t", [
        v.object({ t: v.literal("a"), x: arg(v.string(), { alias: "x" }) }),
        v.object({ t: v.literal("b"), y: v.optional(v.boolean(), false) }),
      ]),
      run: (args) => (args.t === "a" ? (args.x satisfies string) : String(args.y)),
    });
    expect(cmd.name).toBe("ok");

    // @ts-expect-error non-valibot standard schemas must not type-check here
    defineCommand({ name: "ng", args: foreignSchema, run: () => {} });

    // @ts-expect-error non-valibot standard schemas must not type-check here
    arg(foreignSchema, { positional: true });
  });

  it("limits object field metadata to description and flatten", () => {
    arg(v.object({ port: v.number() }), { description: "Server", flatten: "kebab" });
    arg(v.optional(v.object({ port: v.number() })), { flatten: "camel" });
    // @ts-expect-error object fields only accept description and flatten
    arg(v.object({ port: v.number() }), { alias: "c" });
    arg(v.looseObject({ port: v.number() }), { flatten: "kebab" });
    arg(v.objectWithRest({ port: v.number() }, v.string()), { flatten: "kebab" });
    // @ts-expect-error objects with a rest schema are object fields too
    arg(v.objectWithRest({ port: v.number() }, v.string()), { alias: "c" });
    arg(v.record(v.string(), v.string()), { env: "LABELS" });
    // @ts-expect-error flatten can only be used on object fields
    arg(v.string(), { flatten: "dot" });
  });
});
