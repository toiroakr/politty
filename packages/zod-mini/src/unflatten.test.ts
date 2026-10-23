import { describe, expect, it, vi } from "vitest";
import * as z from "zod/mini";
import { arg, defineCommand, extractFields, runCommand, unflatten } from "./index.js";

const flat = () =>
  z.object({
    name: z.optional(z.string()),
    "config.serverPort": arg(z.coerce.number(), { alias: "p" }),
    "config.host": z._default(z.string(), "localhost"),
  });

const run = async (schema: Parameters<typeof defineCommand>[0]["args"], argv: string[]) => {
  const seen: unknown[] = [];
  const cmd = defineCommand({
    name: "app",
    args: schema,
    run: (args) => {
      seen.push(JSON.parse(JSON.stringify(args)));
    },
  });
  const result = await runCommand(cmd, argv);
  return { result, seen };
};

describe("unflatten (zod/mini)", () => {
  it("should hand the validated args to run nested", async () => {
    const { result, seen } = await run(unflatten(flat()), ["-p", "8080"]);

    expect(result.success).toBe(true);
    expect(seen).toEqual([{ config: { serverPort: 8080, host: "localhost" } }]);
  });

  it("should type the nested output", () => {
    const cmd = defineCommand({
      name: "app",
      args: unflatten(flat()),
      run: (args) => {
        args.config.serverPort satisfies number;
        args.config.host satisfies string;
      },
    });
    expect(cmd.name).toBe("app");
  });

  it("should report a validation error at the flat option name", async () => {
    const { result } = await run(unflatten(flat()), ["--config.serverPort", "x"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("config.serverPort");
  });

  it("should nest kebab-case keys after the listed prefixes", async () => {
    const schema = unflatten(
      z.object({ "db-host": z.string(), "db-pool-max": z.coerce.number() }),
      { style: "kebab", prefixes: ["db", "db-pool"] },
    );
    const { seen } = await run(schema, ["--db-host", "h", "--db-pool-max", "3"]);

    expect(seen).toEqual([{ db: { host: "h", pool: { max: 3 } } }]);
  });

  it("should reject a key that is both a value and a group when it is built", () => {
    expect(() => unflatten(z.object({ db: z.string(), "db.host": z.string() }))).toThrow(
      /"db" is both a value and a group/,
    );
  });

  it("should keep the unknown-keys mode of the wrapped object", () => {
    const strict = unflatten(z.strictObject({ "db.host": z.string() }));

    expect(extractFields(strict).unknownKeysMode).toBe("strict");
  });

  it("should call an effect with the nested value", async () => {
    const effect = vi.fn();
    const schema = unflatten(z.object({ "config.port": arg(z.coerce.number(), { effect }) }));

    await run(schema, ["--config.port", "5"]);

    expect(effect).toHaveBeenCalledWith(5, expect.objectContaining({ name: "config.port" }));
  });
});

describe("unflatten in a discriminated union (zod-mini)", () => {
  it("should reject an unflatten schema as an option of a discriminated union", () => {
    const flat = z.object({ kind: z.literal("a"), "a.b": z.string() });
    const schema = z.discriminatedUnion("kind", [unflatten(flat) as never]);

    expect(() => extractFields(schema as never)).toThrow(/unflatten.*union/);
  });
});
