/**
 * Type-level pins: `@politty/zod-mini`'s schema-taking API must reject
 * schemas from other Standard Schema libraries — including classic zod —
 * which would type-check against core's structural constraint but fail at
 * runtime in the zod/mini adapter. Verified by vitest's typecheck pass via
 * `@ts-expect-error`.
 */

import type { SchemaLike } from "@politty/core";
import { describe, expect, it } from "vitest";
import * as z from "zod/mini";
import { arg, defineCommand } from "./index.js";

// A structurally valid Standard Schema that is NOT a zod/mini schema (shaped
// like what another library, e.g. classic zod or valibot, would produce).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const foreignSchema = {
  "~standard": { version: 1, vendor: "not-zod-mini", validate: (value: unknown) => value },
} as unknown as SchemaLike<Record<string, any>>;

describe("@politty/zod-mini type pins", () => {
  it("accepts zod/mini schemas and rejects foreign standard schemas", () => {
    const cmd = defineCommand({
      name: "ok",
      args: z.discriminatedUnion("t", [
        z.object({ t: z.literal("a"), x: arg(z.string(), { alias: "x" }) }),
        z.object({ t: z.literal("b"), y: z._default(z.boolean(), false) }),
      ]),
      run: (args) => (args.t === "a" ? (args.x satisfies string) : String(args.y)),
    });
    expect(cmd.name).toBe("ok");

    // @ts-expect-error non-zod/mini standard schemas must not type-check here
    defineCommand({ name: "ng", args: foreignSchema, run: () => {} });

    // @ts-expect-error non-zod/mini standard schemas must not type-check here
    arg(foreignSchema, { positional: true });
  });
});
