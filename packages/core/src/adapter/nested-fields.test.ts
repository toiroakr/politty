import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { renderArgsTable } from "../docs/render-args.js";
import { arg, defineCommand, extractFields, generateHelp, runCommand } from "../index.js";
import type { AnyCommand } from "../types.js";

function captureArgs(schema: z.ZodType) {
  const seen: unknown[] = [];
  const cmd = defineCommand({
    name: "app",
    args: schema as never,
    run: (args: unknown) => {
      seen.push(JSON.parse(JSON.stringify(args)));
    },
  }) as unknown as AnyCommand;
  return { cmd, seen };
}

describe("nested object fields", () => {
  const schema = z.object({
    name: z.string().optional(),
    config: z
      .object({
        serverPort: arg(z.coerce.number(), { alias: "p" }),
        host: z.string().default("localhost"),
        tls: z
          .object({
            enabled: arg(z.boolean().default(false), { negation: true }),
            cert: z.string().optional(),
          })
          .optional(),
      })
      .optional(),
  });

  it("should expand an object field into one option per property", () => {
    const { fields } = extractFields(schema);
    expect(fields.map((f) => [f.name, f.cliName, f.type, f.required])).toEqual([
      ["name", "name", "string", false],
      ["config.serverPort", "config.server-port", "number", false],
      ["config.host", "config.host", "string", false],
      ["config.tls.enabled", "config.tls.enabled", "boolean", false],
      ["config.tls.cert", "config.tls.cert", "string", false],
    ]);
  });

  it("should nest option values under their property path", async () => {
    const { cmd, seen } = captureArgs(schema);
    const result = await runCommand(cmd, [
      "--config.server-port",
      "80",
      "--config.tls.enabled",
      "--config.tls.cert=c.pem",
    ]);
    expect(result.success).toBe(true);
    expect(seen[0]).toEqual({
      config: { serverPort: 80, host: "localhost", tls: { enabled: true, cert: "c.pem" } },
    });
  });

  it("should expand a readonly object", async () => {
    const { cmd, seen } = captureArgs(
      z.object({ config: z.object({ port: z.coerce.number() }).readonly() }),
    );
    await runCommand(cmd, ["--config.port", "5"]);
    expect(seen).toEqual([{ config: { port: 5 } }]);
  });

  it("should accept the camelCase form, aliases and negation of an option", async () => {
    const { cmd, seen } = captureArgs(schema);
    await runCommand(cmd, ["--config.serverPort", "1", "--no-config.tls.enabled"]);
    await runCommand(cmd, ["-p", "2"]);
    expect(seen).toEqual([
      { config: { serverPort: 1, host: "localhost", tls: { enabled: false } } },
      { config: { serverPort: 2, host: "localhost" } },
    ]);
  });

  it("should leave an optional object absent when none of its options is given", async () => {
    const { cmd, seen } = captureArgs(schema);
    const result = await runCommand(cmd, ["--name", "x"]);
    expect(result.success).toBe(true);
    expect(seen[0]).toEqual({ name: "x" });
  });

  it("should validate the nested values against the object schema", async () => {
    const { cmd } = captureArgs(
      z.object({
        range: z
          .object({ min: z.coerce.number(), max: z.coerce.number() })
          .refine((r) => r.min <= r.max, { message: "min must not exceed max" }),
      }),
    );
    const result = await runCommand(cmd, ["--range.min", "5", "--range.max", "1"]);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("min must not exceed max");
  });

  it("should report a missing property of a required object on its option", async () => {
    const { cmd } = captureArgs(z.object({ db: z.object({ url: z.string() }) }));
    expect(extractFields(z.object({ db: z.object({ url: z.string() }) })).fields[0]?.required).toBe(
      true,
    );
    const result = await runCommand(cmd, []);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("db.url");
  });

  it("should build a required object from its properties' defaults", async () => {
    const { cmd, seen } = captureArgs(
      z.object({
        config: z.object({
          port: z.coerce.number().default(1),
          host: z.string().default("default-host"),
          inner: z.object({ debug: z.boolean().default(false) }),
        }),
      }),
    );
    await runCommand(cmd, ["--config.port", "9"]);
    await runCommand(cmd, []);
    expect(seen).toEqual([
      { config: { port: 9, host: "default-host", inner: { debug: false } } },
      { config: { port: 1, host: "default-host", inner: { debug: false } } },
    ]);
  });

  it("should create a required object inside an optional one once that one is given", async () => {
    const { cmd, seen } = captureArgs(
      z.object({
        config: z
          .object({
            name: z.string().optional(),
            inner: z.object({ debug: z.boolean().default(false) }),
          })
          .optional(),
      }),
    );
    await runCommand(cmd, []);
    await runCommand(cmd, ["--config.name", "x"]);
    expect(seen).toEqual([{}, { config: { name: "x", inner: { debug: false } } }]);
  });

  it("should read property values from their environment variables", async () => {
    vi.stubEnv("NESTED_TEST_PORT", "42");
    try {
      const { cmd, seen } = captureArgs(
        z.object({
          config: z.object({ port: arg(z.coerce.number(), { env: "NESTED_TEST_PORT" }) }),
        }),
      );
      await runCommand(cmd, []);
      expect(seen[0]).toEqual({ config: { port: 42 } });
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("should run a property's effect with its nested value", async () => {
    const effect = vi.fn();
    const { cmd } = captureArgs(
      z.object({ config: z.object({ port: arg(z.coerce.number(), { effect }) }) }),
    );
    await runCommand(cmd, ["--config.port", "3"]);
    expect(effect).toHaveBeenCalledWith(3, expect.objectContaining({ name: "config.port" }));
  });

  it("should nest the properties of the selected discriminated-union variant", async () => {
    const { cmd, seen } = captureArgs(
      z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("server"),
          server: z.object({ port: z.coerce.number().default(80) }),
        }),
        z.object({ mode: z.literal("client"), client: z.object({ url: z.string() }) }),
      ]),
    );
    await runCommand(cmd, ["--mode", "server"]);
    await runCommand(cmd, ["--mode", "client", "--client.url", "http://x"]);
    expect(seen).toEqual([
      { mode: "server", server: { port: 80 } },
      { mode: "client", client: { url: "http://x" } },
    ]);
  });

  it("should nest the properties of a union option", async () => {
    const { cmd, seen } = captureArgs(
      z.union([
        z.object({ file: z.object({ path: z.string() }) }),
        z.object({ url: z.object({ href: z.string() }) }),
      ]),
    );
    await runCommand(cmd, ["--url.href", "http://x"]);
    expect(seen).toEqual([{ url: { href: "http://x" } }]);
  });

  it("should reject single-value metadata on an object field", () => {
    expect(() =>
      extractFields(
        z.object({ config: arg(z.object({ port: z.number() }), { alias: "c" } as never) }),
      ),
    ).toThrow(/alias cannot be used on object fields/);
  });

  it("should show the expanded options in help and docs", () => {
    const cmd = defineCommand({
      name: "app",
      args: z.object({
        config: z
          .object({ serverPort: z.coerce.number().describe("Port to listen on") })
          .describe("Server config"),
      }),
      run: () => {},
    });
    const help = generateHelp(cmd, {});
    expect(help).toContain("--config.server-port");
    expect(help).toContain("<SERVER-PORT>");
    expect(help).toContain("Port to listen on");

    const table = renderArgsTable({
      config: z.object({ host: z.string() }).describe("Server config"),
    });
    expect(table).toContain("--config.host");
    expect(table).toContain("Server config");
  });

  describe("flatten", () => {
    const styled = (flatten: "dot" | "kebab" | "camel") =>
      z.object({
        config: arg(
          z.object({
            serverPort: z.coerce.number().optional(),
            tls: z.object({ enabled: arg(z.boolean().default(false), { negation: true }) }),
          }),
          { flatten },
        ),
      });

    it.each([
      ["dot", ["config.server-port", "config.tls.enabled"], "no-config.tls.enabled"],
      ["kebab", ["config-server-port", "config-tls-enabled"], "no-config-tls-enabled"],
      ["camel", ["configServerPort", "configTlsEnabled"], "noConfigTlsEnabled"],
    ] as const)("should name %s options", (style, cliNames, negation) => {
      const { fields } = extractFields(styled(style));
      expect(fields.map((f) => f.cliName)).toEqual(cliNames);
      expect(fields[1]?.negationDisplay).toBe(negation);
    });

    it.each([
      [
        "dot",
        ["--config.server-port", "1"],
        ["--config.serverPort", "2", "--no-config.tls.enabled"],
      ],
      [
        "kebab",
        ["--config-server-port", "1"],
        ["--configServerPort", "2", "--no-config-tls-enabled"],
      ],
      ["camel", ["--configServerPort", "1"], ["--config-server-port", "2", "--noConfigTlsEnabled"]],
    ] as const)("should accept both spellings of %s options", async (style, shown, other) => {
      const { cmd, seen } = captureArgs(styled(style));
      await runCommand(cmd, [...shown]);
      await runCommand(cmd, [...other]);
      expect(seen).toEqual([
        { config: { serverPort: 1, tls: { enabled: false } } },
        { config: { serverPort: 2, tls: { enabled: false } } },
      ]);
    });

    it("should let a nested object override the inherited style", () => {
      const { fields } = extractFields(
        z.object({
          config: arg(z.object({ db: arg(z.object({ url: z.string() }), { flatten: "dot" }) }), {
            flatten: "kebab",
          }),
        }),
      );
      expect(fields.map((f) => [f.name, f.cliName])).toEqual([["configDb.url", "config-db.url"]]);
    });

    it("should reject an invalid style or flatten on a non-object field", () => {
      expect(() =>
        extractFields(z.object({ config: arg(z.object({}), { flatten: "snake" } as never) })),
      ).toThrow(/Invalid flatten "snake"/);
      expect(() => extractFields(z.object({ port: arg(z.string(), { flatten: "dot" }) }))).toThrow(
        /only be used on object fields/,
      );
    });

    it("should reject an option that collides with another field", async () => {
      const cmd = defineCommand({
        name: "app",
        args: z.object({
          configPort: z.string().optional(),
          config: arg(z.object({ port: z.string().optional() }), { flatten: "kebab" }),
        }),
        run: () => {},
      });
      const result = await runCommand(cmd, []);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("configPort");
    });
  });

  describe("rejected schemas", () => {
    it("should reject a default on an object field", () => {
      for (const config of [
        z.object({ port: z.number() }).default({ port: 1 }),
        z.object({ port: z.number() }).nullable().default(null),
        z.object({ db: z.object({ port: z.number() }).default({ port: 1 }) }),
        z.object({ port: z.number().default(1) }).prefault({}),
        z.object({ port: z.number() }).catch({ port: 1 }),
        z.object({ port: z.number() }).optional().catch(undefined),
      ]) {
        expect(() => extractFields(z.object({ config }))).toThrow(/cannot have a default value/);
      }
    });

    it("should reject an object field without properties", () => {
      for (const config of [
        z.object({}),
        z.object({}).optional(),
        z.object({ db: z.object({}) }),
      ]) {
        expect(() => extractFields(z.object({ config }))).toThrow(/has no properties/);
      }
    });

    it("should check each variant of a discriminated union inside a plain union option", () => {
      const variants = z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("x"), config: z.object({ a: z.string() }) }),
        z.object({ kind: z.literal("y"), config: z.object({ b: z.string().default("d") }) }),
      ]);
      expect(() => extractFields(z.union([variants, z.object({ other: z.string() })]))).toThrow(
        /of a union option is required/,
      );
    });

    describe("branches of a union that give the same option different meanings", () => {
      const variants = (a: z.ZodRawShape, b: z.ZodRawShape) =>
        z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("a"), ...a }),
          z.object({ mode: z.literal("b"), ...b }),
        ]);

      it("should reject an object that is a single value in another branch", () => {
        expect(() =>
          extractFields(
            variants({ config: z.object({ x: z.string().optional() }) }, { config: z.string() }),
          ),
        ).toThrow(/"config" is an object in one branch and a single value in another/);
      });

      it("should reject a property named differently in another branch", () => {
        const config = (flatten: "dot" | "kebab") =>
          arg(z.object({ port: z.coerce.number() }), { flatten });
        expect(() =>
          extractFields(variants({ config: config("dot") }, { config: config("kebab") })),
        ).toThrow(/"config.port" is named differently in another branch/);
      });

      it("should reject an option name that is two different properties in two branches", () => {
        const config = (shape: z.ZodRawShape) => arg(z.object(shape), { flatten: "kebab" });
        expect(() =>
          extractFields(
            variants(
              { config: config({ dbHost: z.string().optional() }) },
              { config: config({ db: z.object({ host: z.string().optional() }) }) },
            ),
          ),
        ).toThrow(
          /"configDbHost" is "config.dbHost" in one branch and "config.db.host" in another/,
        );
      });

      it("should accept the same object in every branch", () => {
        expect(() =>
          extractFields(
            variants(
              { config: z.object({ port: z.coerce.number().optional() }) },
              { config: z.object({ port: z.coerce.number().optional(), url: z.string() }) },
            ),
          ),
        ).not.toThrow();
      });
    });

    it("should reject an effect or requiredPackages under a transformed object", () => {
      const effect = () => {};
      expect(() =>
        extractFields(
          z.object({
            config: z
              .object({ inner: z.object({ v: arg(z.boolean(), { effect }) }) })
              .transform((c) => c.inner),
          }),
        ),
      ).toThrow(
        /Property "config.inner.v" cannot have effect: its object "config" has a transform/,
      );
      expect(() =>
        extractFields(
          z.object({
            config: z
              .object({
                v: arg(z.boolean().optional(), { requiredPackages: [{ name: "x" }] }),
              })
              .optional()
              .transform((c) => c),
          }),
        ),
      ).toThrow(/cannot have requiredPackages/);
      // Refinements keep the value.
      expect(() =>
        extractFields(
          z.object({
            config: z.object({ v: arg(z.boolean(), { effect }) }).refine(() => true),
          }),
        ),
      ).not.toThrow();
    });

    it("should reject an object field defined by several intersection members", () => {
      expect(() =>
        extractFields(
          z.intersection(
            z.object({ config: z.object({ port: z.coerce.number() }) }),
            z.object({ config: z.object({ host: z.string() }) }),
          ),
        ),
      ).toThrow(/Object field "config" is defined by more than one intersection member/);
    });

    it("should reject an object field of a union inside an intersection", () => {
      for (const union of [
        z.union([
          z.object({ config: z.object({ a: z.string() }) }),
          z.object({ config: z.object({ b: z.string() }) }),
        ]),
        z.discriminatedUnion("mode", [
          z.object({ mode: z.literal("a"), a: z.object({ x: z.string() }) }),
          z.object({ mode: z.literal("b"), b: z.string() }),
        ]),
      ]) {
        expect(() =>
          extractFields(z.intersection(union, z.object({ n: z.string().optional() }))),
        ).toThrow(/Object field "(config|a)" of a union inside an intersection/);
      }
      // A union without object fields is fine.
      expect(() =>
        extractFields(
          z.intersection(
            z.union([z.object({ a: z.string() }), z.object({ b: z.string() })]),
            z.object({ config: z.object({ port: z.string().optional() }).optional() }),
          ),
        ),
      ).not.toThrow();
    });

    it("should reject a required object of a union option that no property is required for", () => {
      expect(() =>
        extractFields(
          z.union([
            z.object({ config: z.object({ port: z.coerce.number().default(80) }) }),
            z.object({ name: z.string() }),
          ]),
        ),
      ).toThrow(/Object field "config" of a union option is required/);
      // A required object inside an optional one is never created either.
      expect(() =>
        extractFields(
          z.union([
            z.object({
              config: z
                .object({ name: z.string(), inner: z.object({ debug: z.boolean().optional() }) })
                .optional(),
            }),
            z.object({ name: z.string() }),
          ]),
        ),
      ).toThrow(/Object field "config.inner" of a union option is required/);
      // An object with a required property, or an optional one, is fine.
      expect(() =>
        extractFields(
          z.union([
            z.object({ file: z.object({ path: z.string() }) }),
            z.object({ config: z.object({ port: z.coerce.number().default(80) }).optional() }),
          ]),
        ),
      ).not.toThrow();
    });
  });

  // zod 4.2.1 (the declared peer floor) cannot select a variant from an
  // omitted discriminator, so its own parse reports "No matching discriminator".
  const selectsOmittedDiscriminator = z
    .discriminatedUnion("mode", [
      z.object({ mode: z.literal("a").default("a") }),
      z.object({ mode: z.literal("b") }),
    ])
    .safeParse({}).success;

  it.skipIf(!selectsOmittedDiscriminator)(
    "should create the required objects of the variant a defaulted discriminator selects",
    async () => {
      const { cmd, seen } = captureArgs(
        z.discriminatedUnion("mode", [
          z.object({
            mode: z.literal("server").default("server"),
            server: z.object({ port: z.coerce.number().default(80) }),
          }),
          z.object({ mode: z.literal("client"), client: z.object({ url: z.string() }) }),
        ]),
      );
      await runCommand(cmd, []);
      expect(seen).toEqual([{ mode: "server", server: { port: 80 } }]);
    },
  );

  describe("global args", () => {
    const run = async (
      globalArgs: z.ZodType,
      args: z.ZodType,
      argv: string[],
    ): Promise<{ result: unknown; source: unknown }> => {
      const cmd = defineCommand({
        name: "app",
        args: args as never,
        run: (a: Record<string, unknown> & { $source: (name: string) => unknown }) => ({
          result: JSON.parse(JSON.stringify(a)),
          source: a.$source("config.host"),
        }),
      });
      const r = await runCommand(cmd as never, argv, { globalArgs: globalArgs as never });
      expect(r.success).toBe(true);
      return r.result as { result: unknown; source: unknown };
    };

    it("should merge an object both schemas expand property by property", async () => {
      const { result, source } = await run(
        z.object({ config: z.object({ host: z.string().optional() }) }),
        z.object({ config: z.object({ port: z.coerce.number().default(80) }) }),
        ["--config.host", "x"],
      );
      expect(result).toEqual({ config: { host: "x", port: 80 } });
      expect(source).toBe("cli");
    });

    describe("a discriminated union whose variants share an object name", () => {
      const globalArgs = z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("a"), config: z.object({ host: z.string().optional() }) }),
        z.object({
          mode: z.literal("b"),
          config: z.object({ url: arg(z.string(), { env: "NESTED_TEST_URL" }) }),
        }),
      ]);

      it("should read a property only a later variant has from its option", async () => {
        const { result } = await run(globalArgs, z.object({}), [
          "--mode",
          "b",
          "--config.url",
          "http://cli",
        ]);
        expect(result).toEqual({ mode: "b", config: { url: "http://cli" } });
      });

      it("should read a property only a later variant has from its env", async () => {
        vi.stubEnv("NESTED_TEST_URL", "http://env");
        try {
          const { result } = await run(globalArgs, z.object({}), ["--mode", "b"]);
          expect(result).toEqual({ mode: "b", config: { url: "http://env" } });
        } finally {
          vi.unstubAllEnvs();
        }
      });
    });

    it("should let the command value of a shared property win", async () => {
      const { result } = await run(
        z.object({ config: z.object({ port: z.coerce.number().optional() }) }),
        z.object({
          config: z.object({
            port: z.coerce
              .number()
              .transform((port) => port * 10)
              .optional(),
          }),
        }),
        ["--config.port", "1"],
      );
      expect(result).toEqual({ config: { port: 10 } });
    });

    const runSub = async (globalArgs: z.ZodType, args: z.ZodType, argv: string[]) => {
      const sub = defineCommand({
        name: "sub",
        args: args as never,
        run: (a: Record<string, unknown>) => JSON.parse(JSON.stringify(a)),
      });
      const cmd = defineCommand({ name: "app", subCommands: { sub: sub as never } });
      const r = await runCommand(cmd as never, argv, { globalArgs: globalArgs as never });
      expect(r.success).toBe(true);
      return r.result;
    };

    it("should share a property whose option names differ by flatten style", async () => {
      const result = await runSub(
        z.object({ config: arg(z.object({ port: z.coerce.number() }), { flatten: "kebab" }) }),
        z.object({ config: arg(z.object({ port: z.coerce.number() }), { flatten: "dot" }) }),
        ["--config-port", "5", "sub"],
      );
      expect(result).toEqual({ config: { port: 5 } });
    });

    it("should share a property of an object a transform reshapes", async () => {
      const schema = () =>
        z.object({
          config: z.object({ port: z.coerce.number() }).transform((config) => ({ p: config.port })),
        });
      const result = await runSub(schema(), schema(), ["--config.port", "5", "sub"]);
      expect(result).toEqual({ config: { p: 5 } });
    });

    it("should report an invalid nested global option before a bare group shows help", async () => {
      const sub = defineCommand({ name: "sub", run: () => {} });
      const cmd = defineCommand({ name: "app", subCommands: { sub } });
      const r = await runCommand(cmd as never, ["--config.port", "nope"], {
        globalArgs: z.object({ config: z.object({ port: z.coerce.number().optional() }) }) as never,
      });
      expect(r.success).toBe(false);
      expect(r.error?.message).toContain("config.port");
    });
  });
});
