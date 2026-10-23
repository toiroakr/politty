import * as v from "valibot";
import { describe, expect, it, vi } from "vitest";
import { arg, defineCommand, extractFields, runCommand, unflatten } from "./index.js";

const flat = () =>
  v.object({
    name: v.optional(v.string()),
    "config.serverPort": arg(v.pipe(v.string(), v.transform(Number)), { alias: "p" }),
    "config.host": v.optional(v.string(), "localhost"),
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

describe("unflatten (valibot)", () => {
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

  it("should nest kebab-case keys after the listed prefixes", async () => {
    const schema = unflatten(v.object({ "db-host": v.string(), "db-pool-max": v.string() }), {
      style: "kebab",
      prefixes: ["db", "db-pool"],
    });
    const { seen } = await run(schema, ["--db-host", "h", "--db-pool-max", "3"]);

    expect(seen).toEqual([{ db: { host: "h", pool: { max: "3" } } }]);
  });

  it("should reject a key that is both a value and a group when it is built", () => {
    expect(() => unflatten(v.object({ db: v.string(), "db.host": v.string() }))).toThrow(
      /"db" is both a value and a group/,
    );
  });

  it("should keep the unknown-keys mode of the wrapped object", () => {
    const strict = unflatten(v.strictObject({ "db.host": v.string() }));

    expect(extractFields(strict).unknownKeysMode).toBe("strict");
  });

  it("should call an effect with the nested value", async () => {
    const effect = vi.fn();
    const schema = unflatten(
      v.object({ "config.port": arg(v.pipe(v.string(), v.transform(Number)), { effect }) }),
    );

    await run(schema, ["--config.port", "5"]);

    expect(effect).toHaveBeenCalledWith(5, expect.objectContaining({ name: "config.port" }));
  });
});

describe("unflatten in a discriminated union (valibot)", () => {
  it("should reject an unflatten schema as an option of a variant", () => {
    const flat = v.object({ kind: v.literal("a"), "a.b": v.string() });
    const schema = v.variant("kind", [unflatten(flat) as never]);

    expect(() => extractFields(schema as never)).toThrow(/unflatten.*union/);
  });
});
