import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
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

  it("should expand an object field into one option per leaf", () => {
    const { fields } = extractFields(schema);
    expect(fields.map((f) => [f.name, f.cliName, f.type, f.required])).toEqual([
      ["name", "name", "string", false],
      ["config.serverPort", "config.server-port", "number", false],
      ["config.host", "config.host", "string", false],
      ["config.tls.enabled", "config.tls.enabled", "boolean", false],
      ["config.tls.cert", "config.tls.cert", "string", false],
    ]);
  });

  it("should nest leaf values under their property path", async () => {
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

  it("should accept the camelCase form, aliases and negation of a dot option", async () => {
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

  it("should report a missing leaf of a required object on the leaf", async () => {
    const { cmd } = captureArgs(z.object({ db: z.object({ url: z.string() }) }));
    const result = await runCommand(cmd, []);
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain("db.url");
  });

  it("should fill unspecified properties from the object default", async () => {
    const { cmd, seen } = captureArgs(
      z.object({
        config: z
          .object({ port: z.coerce.number(), host: z.string() })
          .default({ port: 1, host: "default-host" }),
      }),
    );
    await runCommand(cmd, ["--config.port", "9"]);
    await runCommand(cmd, []);
    expect(seen).toEqual([
      { config: { port: 9, host: "default-host" } },
      { config: { port: 1, host: "default-host" } },
    ]);
  });

  it("should show a property's default from the object default in help", () => {
    const { fields } = extractFields(
      z.object({ config: z.object({ port: z.number() }).default({ port: 3 }) }),
    );
    expect(fields[0]?.defaultValue).toBe(3);
  });

  it("should read leaf values from their environment variables", async () => {
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

  it("should run leaf effects with the leaf value", async () => {
    const effect = vi.fn();
    const { cmd } = captureArgs(
      z.object({ config: z.object({ port: arg(z.coerce.number(), { effect }) }) }),
    );
    await runCommand(cmd, ["--config.port", "5"]);
    expect(effect).toHaveBeenCalledWith(5, expect.objectContaining({ name: "config.port" }));
  });

  it("should nest leaves of the selected discriminated-union variant", async () => {
    const { cmd, seen } = captureArgs(
      z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("remote"), db: z.object({ url: z.string() }) }),
        z.object({ mode: z.literal("local") }),
      ]),
    );
    await runCommand(cmd, ["--mode", "remote", "--db.url", "postgres://x"]);
    await runCommand(cmd, ["--mode", "local"]);
    expect(seen).toEqual([{ mode: "remote", db: { url: "postgres://x" } }, { mode: "local" }]);
  });

  it("should nest leaves of global args", async () => {
    const seen: unknown[] = [];
    const sub = defineCommand({
      name: "sub",
      run: (args) => {
        seen.push(JSON.parse(JSON.stringify(args)));
      },
    });
    const main = defineCommand({ name: "app", subCommands: { sub } });
    const result = await runCommand(main, ["--log.level", "debug", "sub"], {
      globalArgs: z.object({ log: z.object({ level: z.string() }).optional() }),
    });
    expect(result.success).toBe(true);
    expect(seen[0]).toEqual({ log: { level: "debug" } });
  });

  describe("flatten styles", () => {
    const styled = (flatten: "dot" | "kebab" | "camel") =>
      z.object({
        config: arg(
          z.object({
            serverPort: z.coerce.number().optional(),
            tls: z.object({ enabled: arg(z.boolean().optional(), { negation: true }) }).optional(),
          }),
          { flatten },
        ).optional(),
      });

    it.each([
      ["dot", "config.server-port", "config.tls.enabled", "no-config.tls.enabled"],
      ["kebab", "config-server-port", "config-tls-enabled", "no-config-tls-enabled"],
      ["camel", "configServerPort", "configTlsEnabled", "noConfigTlsEnabled"],
    ] as const)("should name %s options", async (style, port, enabled, negation) => {
      const fields = extractFields(styled(style)).fields;
      expect(fields.map((f) => f.cliName)).toEqual([port, enabled]);
      expect(fields[1]?.negationDisplay).toBe(negation);

      const { cmd, seen } = captureArgs(styled(style));
      await runCommand(cmd, [`--${port}`, "8", `--${negation}`]);
      expect(seen[0]).toEqual({ config: { serverPort: 8, tls: { enabled: false } } });
    });

    it.each([
      ["kebab", "configServerPort", "noConfigTlsEnabled"],
      ["camel", "config-server-port", "no-config-tls-enabled"],
    ] as const)(
      "should also accept the other case form of %s options",
      async (style, port, negation) => {
        const { cmd, seen } = captureArgs(styled(style));
        await runCommand(cmd, [`--${port}`, "8", `--${negation}`]);
        expect(seen[0]).toEqual({ config: { serverPort: 8, tls: { enabled: false } } });
      },
    );

    it("should keep the kebab-case form of camel options out of help", () => {
      const { cmd } = captureArgs(styled("camel"));
      expect(generateHelp(cmd, {})).not.toContain("config-server-port");
    });

    it("should let a nested object override the inherited style", () => {
      const { fields } = extractFields(
        z.object({
          config: arg(
            z.object({ tls: arg(z.object({ certFile: z.string() }), { flatten: "dot" }) }),
            { flatten: "kebab" },
          ),
        }),
      );
      expect(fields.map((f) => f.cliName)).toEqual(["config-tls.cert-file"]);
    });

    it("should render leaf options in help with a property placeholder", () => {
      const { cmd } = captureArgs(styled("kebab"));
      const help = generateHelp(cmd, {});
      expect(help).toContain("--config-server-port <SERVER-PORT>");
      expect(help).toContain("--config-tls-enabled / --no-config-tls-enabled");
    });
  });

  describe("errors", () => {
    it.each([
      [
        "kebab leaf vs top-level field",
        z.object({
          configPort: z.string().optional(),
          config: arg(z.object({ port: z.string() }), { flatten: "kebab" }).optional(),
        }),
        /"config\.port" \(--config-port\) collides with field "configPort" \(--config-port\)/,
      ],
      [
        "camel leaf vs top-level field",
        z.object({
          configPort: z.string().optional(),
          config: arg(z.object({ port: z.string() }), { flatten: "camel" }).optional(),
        }),
        /"config\.port" \(--configPort\) collides with field "configPort"/,
      ],
      [
        "two leaves",
        z.object({
          a: arg(z.object({ bC: z.string() }), { flatten: "kebab" }).optional(),
          aB: arg(z.object({ c: z.string() }), { flatten: "kebab" }).optional(),
        }),
        /"aB\.c" \(--a-b-c\) collides with field "a\.bC" \(--a-b-c\)/,
      ],
      [
        "leaf vs long alias",
        z.object({
          x: arg(z.string().optional(), { alias: "config-port" }),
          config: arg(z.object({ port: z.string() }), { flatten: "kebab" }).optional(),
        }),
        /"config\.port" \(--config-port\) collides with field "x"/,
      ],
    ])("should reject a collision between %s", (_, args, message) => {
      expect(() => extractFields(args)).toThrow(message);
    });

    it("should not treat a dot leaf and a kebab top-level field as colliding", async () => {
      const { cmd, seen } = captureArgs(
        z.object({
          configPort: z.string().optional(),
          config: z.object({ port: z.string() }).optional(),
        }),
      );
      await runCommand(cmd, ["--config.port", "1", "--config-port", "2"]);
      expect(seen[0]).toEqual({ configPort: "2", config: { port: "1" } });
    });

    it("should reject value-level metadata on an object field", () => {
      expect(() =>
        extractFields(
          z.object({
            // @ts-expect-error Object fields only accept description and flatten.
            config: arg(z.object({ port: z.string() }), { alias: "c", env: "C" }),
          }),
        ),
      ).toThrow('object field "config": alias, env cannot be used on object fields');
    });

    it("should reject flatten on a non-object field", () => {
      expect(() =>
        // @ts-expect-error flatten can only be used on object fields.
        extractFields(z.object({ s: arg(z.string(), { flatten: "dot" }) })),
      ).toThrow('Invalid flatten for field "s": flatten can only be used on object fields.');
    });

    it("should reject an unknown flatten style", () => {
      expect(() =>
        extractFields(
          // @ts-expect-error flatten only accepts the supported naming styles.
          z.object({ c: arg(z.object({ a: z.string() }), { flatten: "snake" }) }),
        ),
      ).toThrow('Invalid flatten "snake" for field "c"');
    });
  });
});
