import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { collectOptionTokens, quotedAvailabilityTokens } from "../completion/shell-shared.js";
import { renderArgsTable } from "../docs/render-args.js";
import { arg, defineCommand, extractFields, generateHelp, runCommand } from "../index.js";
import type { AnyCommand } from "../types.js";
import { validateArgs } from "../validator/args-validator.js";
import { nestingCandidates } from "./nested-fields.js";

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

  describe("object reconstruction", () => {
    it("should keep values regardless of declaration order when a flat name equals an object key", async () => {
      const { cmd, seen } = captureArgs(
        z.object({
          aB: z.object({ c: z.string() }).optional(),
          a: arg(z.object({ b: z.string() }), { flatten: "kebab" }).optional(),
        }),
      );
      await runCommand(cmd, ["--a-b.c", "C", "--a-b", "B"]);
      expect(seen[0]).toEqual({ aB: { c: "C" }, a: { b: "B" } });
    });

    it("should create required empty objects", async () => {
      const { cmd, seen } = captureArgs(
        z.object({
          config: z.object({ port: z.coerce.number().optional(), extra: z.object({}) }).optional(),
          empty: z.object({}),
        }),
      );
      await runCommand(cmd, []);
      await runCommand(cmd, ["--config.port", "1"]);
      expect(seen).toEqual([{ empty: {} }, { config: { port: 1, extra: {} }, empty: {} }]);
    });

    it("should create required objects inside an optional object that is given", async () => {
      const { cmd, seen } = captureArgs(
        z.object({
          config: z
            .object({
              port: z.coerce.number().optional(),
              tls: z.object({ enabled: z.boolean().default(false) }),
            })
            .optional(),
        }),
      );
      await runCommand(cmd, ["--config.port", "80"]);
      expect(seen[0]).toEqual({ config: { port: 80, tls: { enabled: false } } });
    });

    it("should nest with the selected variant's object defaults and required objects", async () => {
      const { cmd, seen } = captureArgs(
        z.discriminatedUnion("mode", [
          z.object({
            mode: z.literal("a"),
            config: z
              .object({ port: z.coerce.number(), host: z.string() })
              .default({ port: 1, host: "host-a" }),
            db: z.object({ port: z.coerce.number().default(80) }),
          }),
          z.object({
            mode: z.literal("b"),
            config: z
              .object({ port: z.coerce.number(), host: z.string() })
              .default({ port: 2, host: "host-b" }),
          }),
        ]),
      );
      await runCommand(cmd, ["--mode", "b", "--config.port", "9"]);
      await runCommand(cmd, ["--mode", "a"]);
      expect(seen).toEqual([
        { mode: "b", config: { port: 9, host: "host-b" } },
        { mode: "a", config: { port: 1, host: "host-a" }, db: { port: 80 } },
      ]);
    });

    it("should nest by the union option that validates", async () => {
      const { cmd, seen } = captureArgs(
        z.union([
          z.object({ a: z.object({ x: z.string() }) }),
          z.object({ b: z.object({ y: z.string().default("d") }) }),
        ]),
      );
      await runCommand(cmd, ["--a.x", "1"]);
      await runCommand(cmd, []);
      expect(seen).toEqual([{ a: { x: "1" } }, { b: { y: "d" } }]);
    });

    it("should keep the properties of both members of an intersection", async () => {
      const { cmd, seen } = captureArgs(
        z.intersection(
          z.object({ config: z.object({ host: z.string() }) }),
          z.object({ config: z.object({ port: z.coerce.number() }) }),
        ),
      );
      await runCommand(cmd, ["--config.host", "h", "--config.port", "1"]);
      expect(seen[0]).toEqual({ config: { host: "h", port: 1 } });
    });

    it("should list leaves that only a later variant defines and run their effects", async () => {
      const effect = vi.fn();
      const schema = z.discriminatedUnion("mode", [
        z.object({ mode: z.literal("a"), config: z.object({ host: z.string() }) }),
        z.object({
          mode: z.literal("b"),
          config: z.object({ port: arg(z.coerce.number(), { effect }) }),
        }),
      ]);
      expect(extractFields(schema).fields.map((f) => f.name)).toContain("config.port");
      const { cmd } = captureArgs(schema);
      await runCommand(cmd, ["--mode", "b", "--config.port", "3"]);
      expect(effect).toHaveBeenCalledWith(3, expect.objectContaining({ name: "config.port" }));
    });

    it("should check required packages of nested boolean options", async () => {
      const { cmd } = captureArgs(
        z.object({
          config: z
            .object({
              ui: arg(z.boolean().optional(), {
                requiredPackages: [{ name: "@politty-test/missing-ui" }],
              }),
            })
            .optional(),
        }),
      );
      expect((await runCommand(cmd, [])).success).toBe(true);
      const result = await runCommand(cmd, ["--config.ui"]);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("@politty-test/missing-ui");
    });
  });

  describe("union and intersection reconstruction", () => {
    const modes = (config: (mode: string) => z.ZodType) =>
      z.union([
        z.object({ mode: z.literal("a"), a: z.object({ x: z.string() }), config: config("a") }),
        z.object({ mode: z.literal("b"), config: config("b") }),
      ]);

    it("should not let another union option drop a given value", async () => {
      const { cmd, seen } = captureArgs(
        z.union([
          z.object({ mode: z.literal("a"), a: z.object({ x: z.string().optional() }) }),
          z.object({ mode: z.literal("b"), config: z.object({ port: z.string() }).optional() }),
        ]),
      );
      await runCommand(cmd, ["--mode", "b", "--config.port", "80"]);
      expect(seen[0]).toEqual({ mode: "b", config: { port: "80" } });
    });

    it("should use the matching union option's object default", async () => {
      const { cmd, seen } = captureArgs(
        modes((mode) =>
          z
            .object({ port: z.string(), host: z.string() })
            .default({ port: "1", host: `host-${mode}` }),
        ),
      );
      await runCommand(cmd, ["--mode", "b", "--config.port", "9"]);
      expect(seen[0]).toEqual({ mode: "b", config: { port: "9", host: "host-b" } });
    });

    it("should require an intersection object when either member requires it", async () => {
      const { cmd, seen } = captureArgs(
        z.intersection(
          z.object({ config: z.object({ host: z.string().default("h") }).optional() }),
          z.object({ config: z.object({ port: z.coerce.number().default(80) }) }),
        ),
      );
      await runCommand(cmd, []);
      expect(seen[0]).toEqual({ config: { host: "h", port: 80 } });
    });

    it("should merge an object both intersection members define inside an object", async () => {
      const { cmd, seen } = captureArgs(
        z.intersection(
          z.object({ config: z.object({ tls: z.object({ cert: z.string() }) }) }),
          z.object({ config: z.object({ tls: z.object({ key: z.string() }) }) }),
        ),
      );
      await runCommand(cmd, ["--config.tls.cert", "c", "--config.tls.key", "k"]);
      expect(seen[0]).toEqual({ config: { tls: { cert: "c", key: "k" } } });
    });
  });

  describe("union fallback", () => {
    const configs = (
      union: (options: [z.ZodObject<z.ZodRawShape>, z.ZodObject<z.ZodRawShape>]) => z.ZodType,
    ) =>
      union([
        z.object({
          mode: z.literal("a"),
          config: z
            .object({ port: z.string(), host: z.string() })
            .default({ port: "1", host: "a" }),
        }),
        z.object({
          mode: z.literal("b"),
          config: z.object({ port: z.string(), host: z.string() }),
        }),
      ]);

    it.each([
      ["discriminated union", configs((options) => z.discriminatedUnion("mode", options))],
      ["union", configs((options) => z.union(options))],
    ])("should not borrow another option's default in a %s", async (_, schema) => {
      const { cmd, seen } = captureArgs(schema);
      const result = await runCommand(cmd, ["--mode", "b", "--config.host", "h"]);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("config.port");
      expect(seen).toEqual([]);
    });

    it("should reject options no single union option defines together", () => {
      const schema = z.union([
        z.object({ a: z.object({ x: z.string() }).optional() }),
        z.object({ b: z.object({ y: z.string() }).optional() }),
      ]);
      const result = validateArgs({ "a.x": "1", "b.y": "2" }, schema);
      expect(result.success).toBe(false);
      expect(!result.success && result.errors[0]?.message).toContain("--a.x, --b.y");
    });
  });

  describe("branch selection", () => {
    const defaultedMode = () =>
      z.discriminatedUnion("mode", [
        z.object({
          mode: z.literal("a").default("a"),
          config: z.object({ port: z.string() }).optional(),
        }),
        z.object({ mode: z.literal("b") }),
      ]);

    it("should select a variant by a defaulted discriminator", async () => {
      const { cmd, seen } = captureArgs(defaultedMode());
      await runCommand(cmd, ["--mode", "a", "--config.port", "x"]);
      expect(seen).toEqual([{ mode: "a", config: { port: "x" } }]);

      // Without --mode, the variant whose discriminator has a default nests
      // the args. (Whether the union then applies that default depends on
      // the zod version, so check the nesting itself.)
      const [candidate] = nestingCandidates({ "config.port": "y" }, extractFields(defaultedMode()));
      expect(candidate).toMatchObject({ args: { config: { port: "y" } } });
      expect(candidate?.diagnosticOnly).toBeUndefined();
    });

    it("should keep the selected variant's own field named like another variant's leaf", async () => {
      const { cmd, seen } = captureArgs(
        z.discriminatedUnion("mode", [
          z.object({
            mode: z.literal("a"),
            config: z.object({ host: z.string() }),
            configPort: z.string().optional(),
          }),
          z.object({
            mode: z.literal("b"),
            config: arg(z.object({ port: z.string() }), { flatten: "kebab" }),
          }),
        ]),
      );
      await runCommand(cmd, ["--mode", "a", "--config.host", "h", "--config-port", "80"]);
      expect(seen[0]).toEqual({ mode: "a", config: { host: "h" }, configPort: "80" });
    });

    it("should not let an earlier union option silently drop a given value", async () => {
      const { cmd, seen } = captureArgs(
        z.union([
          z.object({ name: z.string().optional() }),
          z.object({ config: z.object({ port: z.string() }) }),
        ]),
      );
      const result = await runCommand(cmd, ["--config.port", "80"]);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("config.port would be ignored");
      expect(seen).toEqual([]);
    });
  });

  describe("union and intersection details", () => {
    it("should accept a union whose transform moves a nested value", async () => {
      const { cmd, seen } = captureArgs(
        z
          .union([
            z.object({ a: z.object({ x: z.string() }) }),
            z.object({ config: z.object({ port: z.string() }) }),
          ])
          .transform((value) => ("config" in value ? { selected: value.config } : value)),
      );
      const result = await runCommand(cmd, ["--config.port", "80"]);
      expect(result.error).toBeUndefined();
      expect(seen[0]).toEqual({ selected: { port: "80" } });
    });

    it("should keep the defaults of both intersection members", async () => {
      const { cmd, seen } = captureArgs(
        z.intersection(
          z.object({ config: z.object({ host: z.string() }).default({ host: "h" }) }),
          z.object({ config: z.object({ port: z.string() }).default({ port: "80" }) }),
        ),
      );
      await runCommand(cmd, ["--config.host", "remote"]);
      expect(seen[0]).toEqual({ config: { host: "remote", port: "80" } });
    });

    it("should not check collisions across exclusive variants", async () => {
      const { cmd, seen } = captureArgs(
        z.discriminatedUnion("mode", [
          z.object({
            mode: z.literal("b"),
            config: arg(z.object({ port: z.string() }), { flatten: "kebab" }),
          }),
          z.object({
            mode: z.literal("a"),
            config: z.object({ host: z.string() }),
            configPort: z.string().optional(),
          }),
        ]),
      );
      await runCommand(cmd, ["--mode", "a", "--config.host", "h", "--config-port", "80"]);
      await runCommand(cmd, ["--mode", "b", "--config-port", "81"]);
      expect(seen).toEqual([
        { mode: "a", config: { host: "h" }, configPort: "80" },
        { mode: "b", config: { port: "81" } },
      ]);
    });
  });

  describe("wrappers and spellings", () => {
    it("should expand readonly and prefault objects", async () => {
      expect(
        extractFields(
          z.object({
            config: arg(z.object({ port: z.string() }).readonly(), { flatten: "kebab" }),
          }),
        ).fields.map((f) => f.cliName),
      ).toEqual(["config-port"]);

      const { cmd, seen } = captureArgs(
        z.object({
          config: z
            .object({ port: z.string(), host: z.string() })
            .prefault({ port: "1", host: "h" }),
        }),
      );
      await runCommand(cmd, ["--config.port", "2"]);
      expect(seen[0]).toEqual({ config: { port: "2", host: "h" } });
    });

    it("should show a negation runtime accepts under a camelCase prefix", async () => {
      const schema = z.object({
        config: arg(
          z.object({
            tls: arg(z.object({ enabled: arg(z.boolean().optional(), { negation: true }) }), {
              flatten: "dot",
            }),
          }),
          { flatten: "camel" },
        ).optional(),
      });
      const [field] = extractFields(schema).fields;
      expect(field?.negationDisplay).toBe("no-config-tls.enabled");
      const { cmd, seen } = captureArgs(schema);
      await runCommand(cmd, [`--${field?.negationDisplay}`]);
      expect(seen[0]).toEqual({ config: { tls: { enabled: false } } });
    });

    it("should let shell completion match the kebab-case form of camel options", () => {
      expect(collectOptionTokens("configMode", undefined)).toContain("--config-mode");
      // A camelCase parent with a kebab-case child mixes both styles.
      expect(collectOptionTokens("configTls-cert-file", undefined)).toEqual(
        expect.arrayContaining(["--configTlsCertFile", "--config-tls-cert-file"]),
      );
      expect(quotedAvailabilityTokens("configUi", undefined, "noConfigUi")).toContain(
        '"--no-config-ui"',
      );
    });

    it("should document the options of object fields in an args table", () => {
      const table = renderArgsTable({ config: z.object({ port: z.number() }) });
      expect(table).toContain("--config.port");
      expect(table).not.toContain("--config <");
    });
  });

  describe("object defaults", () => {
    it("should not report a transformed default value as the user's error", async () => {
      const { cmd } = captureArgs(
        z.object({
          config: z
            .object({ port: z.string().transform(Number), host: z.string() })
            .default({ port: 80, host: "local" }),
        }),
      );
      const result = await runCommand(cmd, ["--config.host", "remote"]);
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("config.port");
      expect(result.error?.message).not.toContain("received number");
    });
  });

  describe("global args", () => {
    it("should merge global and command properties of the same object", async () => {
      const seen: unknown[] = [];
      const sub = defineCommand({
        name: "sub",
        args: z.object({ log: z.object({ file: z.string() }).optional() }),
        run: (args) => {
          seen.push(JSON.parse(JSON.stringify(args)));
        },
      });
      const main = defineCommand({ name: "app", subCommands: { sub } });
      const result = await runCommand(main, ["--log.level", "debug", "sub", "--log.file", "f"], {
        globalArgs: z.object({ log: z.object({ level: z.string() }).optional() }),
      });
      expect(result.success).toBe(true);
      expect(seen[0]).toEqual({ log: { level: "debug", file: "f" } });
    });

    it("should keep non-plain values when merging global and command objects", async () => {
      const seen: unknown[] = [];
      const when = () =>
        z.object({ when: z.object({ at: z.string().transform((v) => new Date(v)) }).optional() });
      const sub = defineCommand({
        name: "sub",
        args: when(),
        run: (args) => {
          seen.push(args.when?.at);
        },
      });
      const main = defineCommand({ name: "app", subCommands: { sub } });
      const result = await runCommand(
        main,
        ["--when.at", "2020-01-01", "sub", "--when.at", "2021-01-01"],
        { globalArgs: when() },
      );
      expect(result.success).toBe(true);
      expect(seen[0]).toEqual(new Date("2021-01-01"));
    });

    it("should replace an object-valued option rather than merge it", async () => {
      const seen: unknown[] = [];
      const labels = () =>
        z.object({
          config: z
            .object({ labels: z.string().transform((v) => JSON.parse(v) as unknown) })
            .optional(),
        });
      const sub = defineCommand({
        name: "sub",
        args: labels(),
        run: (args) => {
          seen.push(args.config?.labels);
        },
      });
      const main = defineCommand({ name: "app", subCommands: { sub } });
      await runCommand(
        main,
        ["--config.labels", '{"old":1}', "sub", "--config.labels", '{"new":2}'],
        { globalArgs: labels() },
      );
      expect(seen[0]).toEqual({ new: 2 });
    });

    it("should pre-fill a nested option from a flat global field of the same name", async () => {
      const seen: unknown[] = [];
      const sub = defineCommand({
        name: "sub",
        args: z.object({ config: arg(z.object({ port: z.string() }), { flatten: "kebab" }) }),
        run: (args) => {
          seen.push(JSON.parse(JSON.stringify(args)));
        },
      });
      const main = defineCommand({ name: "app", subCommands: { sub } });
      const result = await runCommand(main, ["--config-port", "80", "sub"], {
        globalArgs: z.object({ configPort: z.string().optional() }),
      });
      expect(result.error).toBeUndefined();
      expect(seen[0]).toMatchObject({ config: { port: "80" } });
    });

    it("should pre-fill a nested option both schemas define from the global value", async () => {
      const seen: unknown[] = [];
      const config = () => z.object({ config: z.object({ port: z.string() }) });
      const sub = defineCommand({
        name: "sub",
        args: config(),
        run: (args) => {
          seen.push(JSON.parse(JSON.stringify(args)));
        },
      });
      const main = defineCommand({ name: "app", subCommands: { sub } });
      const result = await runCommand(main, ["--config.port", "80", "sub"], {
        globalArgs: config(),
      });
      expect(result.success).toBe(true);
      expect(seen[0]).toEqual({ config: { port: "80" } });
    });
  });

  describe("leaf metadata", () => {
    it("should describe a leaf without its own description by its object", () => {
      const { fields } = extractFields(
        z.object({
          config: arg(z.object({ port: z.number(), host: z.string().describe("Host name") }), {
            description: "Server settings",
          }),
        }),
      );
      expect(fields.map((f) => f.description)).toEqual(["Server settings", "Host name"]);
    });

    it("should keep an explicit null default over the object default", () => {
      const { fields } = extractFields(
        z.object({
          config: z
            .object({ name: z.string().nullable().default(null) })
            .default({ name: "object-default" }),
        }),
      );
      expect(fields[0]?.defaultValue).toBeNull();
    });
  });
});
