import { getFieldValue, pathResolver } from "@politty/core/adapter/unflatten";
import * as l from "loculus";
import { describe, expect, it, vi } from "vitest";
import { arg, defineCommand, extractFields, runCommand, unflatten } from "./index.js";

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

describe("unflatten (loculus)", () => {
  const flat = () =>
    l.object({
      name: l.string({ optional: true }),
      "config.serverPort": arg(l.number(), { alias: "p" }),
      "config.host": l.string({ default: "localhost" }),
    });

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

  it("should keep the flat keys as the extracted field names", () => {
    expect(extractFields(unflatten(flat())).fields.map((field) => field.name)).toEqual([
      "name",
      "config.serverPort",
      "config.host",
    ]);
  });

  it("should nest kebab-case keys after the listed prefixes", async () => {
    const schema = unflatten(l.object({ "db-host": l.string(), "db-pool-max": l.number() }), {
      style: "kebab",
      prefixes: ["db", "db-pool"],
    });
    const { seen } = await run(schema, ["--db-host", "h", "--db-pool-max", "3"]);

    expect(seen).toEqual([{ db: { host: "h", pool: { max: 3 } } }]);
  });

  it("should reject group names that differ only in kebab-case versus camelCase", () => {
    const schema = l.object({ "server-config.host": l.string(), "serverConfig.port": l.string() });

    expect(() => unflatten(schema)).toThrow(/differ only in case/);
  });

  it("should call an effect with the nested value", async () => {
    const effect = vi.fn();
    const schema = unflatten(l.object({ "config.port": arg(l.number(), { effect }) }));

    await run(schema, ["--config.port", "5"]);

    expect(effect).toHaveBeenCalledWith(5, expect.objectContaining({ name: "config.port" }));
  });
});

describe("unflatten (loculus) paths", () => {
  const cases = [
    { options: {}, keys: ["db.host", "db.pool.max", "name"] },
    {
      options: { style: "kebab", prefixes: ["db", "db-pool"] },
      keys: ["db-host", "db-pool-max", "dry-run"],
    },
    {
      options: { style: "camel", prefixes: ["db", "dbPool"] },
      keys: ["dbHostName", "dbPoolMax", "dbx"],
    },
  ] as const;

  it.each(cases)(
    "should find every value where loculus nests it ($options)",
    ({ options, keys }) => {
      const input = Object.fromEntries(keys.map((key, index) => [key, String(index)]));
      const schema = unflatten(
        l.object(Object.fromEntries(keys.map((key) => [key, l.string()]))),
        options as never,
      );
      const output = l.parse(schema, input) as Record<string, unknown>;
      const pathOf = pathResolver(options as never);

      for (const key of keys) {
        expect(getFieldValue(output, { name: key, nested: { path: pathOf(key) } })).toBe(
          input[key],
        );
      }
    },
  );
});
