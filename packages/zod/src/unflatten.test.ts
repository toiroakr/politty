import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { arg, defineCommand, extractFields, runCommand, unflatten } from "./index.js";

const flat = () =>
  z.object({
    name: z.string().optional(),
    "config.serverPort": arg(z.coerce.number(), { alias: "p", env: "UNFLATTEN_TEST_PORT" }),
    "config.host": z.string().default("localhost"),
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

describe("unflatten", () => {
  it("should hand the validated args to run nested", async () => {
    const { result, seen } = await run(unflatten(flat()), ["--config.serverPort", "8080"]);

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
        args.name satisfies string | undefined;
      },
    });
    expect(cmd.name).toBe("app");
  });

  it("should keep the flat keys as option names with their arg() metadata", async () => {
    const { seen } = await run(unflatten(flat()), ["-p", "9"]);

    expect(seen).toEqual([{ config: { serverPort: 9, host: "localhost" } }]);
  });

  it("should read an env fallback into the nested value", async () => {
    vi.stubEnv("UNFLATTEN_TEST_PORT", "7");
    try {
      const { seen } = await run(unflatten(flat()), []);
      expect(seen).toEqual([{ config: { serverPort: 7, host: "localhost" } }]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("should leave out a group none of whose keys is present", async () => {
    const schema = unflatten(z.object({ name: z.string(), "db.host": z.string().optional() }));
    const { seen } = await run(schema, ["--name", "app"]);

    expect(seen).toEqual([{ name: "app" }]);
  });

  it("should report a validation error at the flat option name", async () => {
    const { result } = await run(unflatten(flat()), ["--config.serverPort", "x"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("config.serverPort");
  });

  it("should nest kebab-case keys after the listed prefixes", async () => {
    const schema = unflatten(
      z.object({
        "db-host": z.string(),
        "db-pool-max": z.coerce.number(),
        "dry-run": z.boolean().default(false),
      }),
      { style: "kebab", prefixes: ["db", "db-pool"] },
    );
    const { seen } = await run(schema, ["--db-host", "h", "--db-pool-max", "3"]);

    expect(seen).toEqual([{ db: { host: "h", pool: { max: 3 } }, "dry-run": false }]);
  });

  it("should nest camelCase keys after the listed prefixes", async () => {
    const schema = unflatten(z.object({ dbHostName: z.string(), dbx: z.coerce.number() }), {
      style: "camel",
      prefixes: ["db"],
    });
    const { seen } = await run(schema, ["--dbHostName", "h", "--dbx", "1"]);

    expect(seen).toEqual([{ db: { hostName: "h" }, dbx: 1 }]);
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
});

describe("unflatten with arg() side effects", () => {
  it("should call an effect with the nested value", async () => {
    const effect = vi.fn();
    const schema = unflatten(z.object({ "config.port": arg(z.coerce.number(), { effect }) }));

    await run(schema, ["--config.port", "5"]);

    expect(effect).toHaveBeenCalledWith(5, expect.objectContaining({ name: "config.port" }));
  });
});

describe("unflatten with requiredPackages", () => {
  const studio = () =>
    unflatten(
      z.object({
        "ui.enabled": arg(z.boolean().default(false), {
          requiredPackages: [
            {
              name: "@politty-test/missing-studio",
              install: "npm install -D @politty-test/missing-studio",
            },
          ],
        }),
      }),
    );

  it("should require the package when the nested flag is enabled", async () => {
    const { result } = await run(studio(), ["--ui.enabled"]);

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("npm install -D @politty-test/missing-studio");
  });

  it("should not require the package when the nested flag is off", async () => {
    const { result } = await run(studio(), []);

    expect(result.success).toBe(true);
  });
});

describe("unflatten with globalArgs", () => {
  const runSub = async (globalArgs: unknown, args: unknown, argv: string[]) => {
    const sub = defineCommand({
      name: "sub",
      args: args as never,
      run: (a: Record<string, unknown>) => JSON.parse(JSON.stringify(a)),
    });
    const cmd = defineCommand({ name: "app", subCommands: { sub: sub as never } });
    const result = await runCommand(cmd, argv, { globalArgs: globalArgs as never });
    expect(result.success).toBe(true);
    return result.result;
  };

  it("should merge a group both schemas nest into", async () => {
    const result = await runSub(
      unflatten(z.object({ "config.host": z.string().default("gh") })),
      unflatten(z.object({ "config.port": z.coerce.number().default(1) })),
      ["sub"],
    );

    expect(result).toEqual({ config: { host: "gh", port: 1 } });
  });

  it("should reject a command value where the global schema nests a group", async () => {
    const sub = defineCommand({
      name: "sub",
      args: z.object({ db: z.string().default("x") }) as never,
      run: () => {},
    });
    const cmd = defineCommand({ name: "app", subCommands: { sub: sub as never } });
    const result = await runCommand(cmd, ["sub"], {
      globalArgs: unflatten(z.object({ "db.host": z.string().default("h") })) as never,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("conflicting output positions");
  });

  it("should reject group names of the two schemas that differ only in case", async () => {
    const sub = defineCommand({
      name: "sub",
      args: unflatten(z.object({ "serverConfig.port": z.string().default("p") })) as never,
      run: () => {},
    });
    const cmd = defineCommand({ name: "app", subCommands: { sub: sub as never } });
    const result = await runCommand(cmd, ["sub"], {
      globalArgs: unflatten(z.object({ "server-config.host": z.string().default("h") })) as never,
    });

    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("conflicting output positions");
  });

  it("should let the command value of a shared key win", async () => {
    const result = await runSub(
      unflatten(z.object({ "config.port": z.coerce.number().default(1) })),
      unflatten(
        z.object({
          "config.port": z.coerce
            .number()
            .transform((n) => n * 10)
            .default(1),
        }),
      ),
      ["--config.port", "2", "sub"],
    );

    expect(result).toEqual({ config: { port: 20 } });
  });

  it("should hand a global value given before the subcommand to the command's same key", async () => {
    const result = await runSub(
      unflatten(z.object({ "config.port": z.coerce.number() })),
      unflatten(z.object({ "config.port": z.coerce.number() })),
      ["--config.port", "5", "sub"],
    );

    expect(result).toEqual({ config: { port: 5 } });
  });
});

describe("unflatten in a discriminated union (zod)", () => {
  it("should reject an unflatten schema as an option of a discriminated union", () => {
    const flat = z.object({ kind: z.literal("a"), "a.b": z.string() });
    const schema = z.discriminatedUnion("kind", [unflatten(flat) as never]);

    expect(() => extractFields(schema as never)).toThrow(/unflatten.*union/);
  });
});
