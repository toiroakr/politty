/**
 * Type-level pins: `@politty/zod`'s schema-taking API must reject schemas
 * from other Standard Schema libraries (they would type-check against
 * core's structural constraint but fail at runtime in the zod adapter).
 * Verified by vitest's typecheck pass via `@ts-expect-error`.
 */

import type { SchemaLike } from "@politty/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg, defineCommand } from "./index.js";

// A structurally valid Standard Schema that is NOT a zod schema (shaped
// like what another library such as valibot would produce).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const foreignSchema = {
  "~standard": { version: 1, vendor: "not-zod", validate: (value: unknown) => value },
} as unknown as SchemaLike<Record<string, any>>;

describe("@politty/zod type pins", () => {
  it("accepts zod schemas and rejects foreign standard schemas", () => {
    const cmd = defineCommand({
      name: "ok",
      args: z.object({ name: arg(z.string(), { positional: true }) }),
      run: (args) => args.name satisfies string,
    });
    expect(cmd.name).toBe("ok");

    // @ts-expect-error non-zod standard schemas must not type-check here
    defineCommand({ name: "ng", args: foreignSchema, run: () => {} });

    // @ts-expect-error non-zod standard schemas must not type-check here
    arg(foreignSchema, { positional: true });
  });
});
