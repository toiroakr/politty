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
});
