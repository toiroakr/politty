import { describe, expect, it } from "vitest";
import { z } from "zod";

import { arg } from "@politty/core/core/arg-registry";
import { extractZodFields } from "./adapter.js";

describe("zod adapter - pipe recursion", () => {
  it("should find a default through a pipe (default declared before a transform)", () => {
    // z.string().default(...).transform(...) becomes a "pipe" node whose
    // def.in is the "default" node — without recursing through def.in,
    // required correctly came out false (isRequired uses isOptional(),
    // which does apply the default) while defaultValue silently stayed
    // undefined.
    const schema = z.object({
      level: z
        .string()
        .default("hello")
        .transform((s) => s.toUpperCase()),
    });
    const extracted = extractZodFields(schema);
    const field = extracted.fields[0];
    expect(field?.required).toBe(false);
    expect(field?.defaultValue).toBe("hello");
  });

  it("should find a description through a pipe (declared before a transform)", () => {
    // Mirrors the default-through-pipe case: a description declared on a
    // pipe's input schema (z.string().describe(...).transform(...)) must
    // still be found, not just descriptions on optional/nullable/default
    // wrappers.
    const schema = z.object({
      name: z
        .string()
        .describe("the desc")
        .transform((s) => s.trim()),
    });
    const extracted = extractZodFields(schema);
    expect(extracted.fields[0]?.description).toBe("the desc");
  });

  it("should find arg() metadata on an intermediate wrapper inside a pipe", () => {
    // arg() keys its registry by exact schema identity. Registering on a
    // default-wrapped schema and then piping it through a transform
    // (arg(z.string().default(...), {...}).transform(...)) put the
    // metadata on the intermediate "default" node — checking only the
    // outer pipe and the fully-unwrapped inner schema skipped it, silently
    // dropping the alias.
    const withDefault = arg(z.string().default("info"), { alias: "L" });
    const schema = z.object({
      level: withDefault.transform((s) => s.toUpperCase()),
    });
    const extracted = extractZodFields(schema);
    const field = extracted.fields[0];
    expect(field?.alias).toEqual(["L"]);
    expect(field?.defaultValue).toBe("info");
  });
});
