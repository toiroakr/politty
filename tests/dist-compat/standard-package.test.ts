import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import * as v from "valibot";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";
import type * as StandardCompletion from "../../packages/politty/src/standard-completion.js";
import type * as StandardDocs from "../../packages/politty/src/standard-docs.js";
import type * as Standard from "../../packages/politty/src/standard.js";
import type * as ZodPolitty from "../../packages/zod/src/index.js";

const requireFromPolitty = createRequire(
  new URL("../../packages/politty/package.json", import.meta.url),
);

function importSubpath<Module>(name: string): Promise<Module> {
  return import(pathToFileURL(requireFromPolitty.resolve(name)).href);
}

const standard = () => importSubpath<typeof Standard>("politty/standard");

describe("politty/standard", () => {
  it("uses input fields for argv, help, and shell completion and preserves validated output", async () => {
    const { defineCommand, generateHelp, runCommand, standardArgs } = await standard();
    const { generateCompletion } = await importSubpath<typeof StandardCompletion>(
      "politty/standard/completion",
    );
    const { buildCommandInfo } = await importSubpath<typeof StandardDocs>("politty/standard/docs");
    const command = defineCommand({
      name: "search",
      args: standardArgs(
        z.object({
          query: z.string().transform((text) => text.length),
          mode: z.enum(["fast", "safe"]).describe("Search strategy").default("safe"),
          loud: z.boolean().default(false),
          include: z.array(z.string()).default([]),
        }),
        { fields: { query: { positional: true }, loud: { alias: "l" } } },
      ),
      run: ({ query, loud, mode, include }) => {
        expectTypeOf(query).toEqualTypeOf<number>();
        return { query, loud, mode, include };
      },
    });

    expect(
      await runCommand(command, ["hello", "-l", "--include", "x", "--include", "y"]),
    ).toMatchObject({
      success: true,
      result: { query: 5, loud: true, mode: "safe", include: ["x", "y"] },
    });
    expect(generateHelp(command, {})).toContain("Search strategy");
    expect(generateCompletion(command, { shell: "bash", programName: "search" }).script).toContain(
      '"fast" "safe"',
    );
    expect(
      (await buildCommandInfo(command, "search")).positionalArgs.map(({ name }) => name),
    ).toEqual(["query"]);
    expect(await runCommand(command, ["hello", "--mode", "invalid"])).toMatchObject({
      success: false,
      error: { message: expect.stringContaining("mode") },
    });
  });

  it("uses a separate converter for a Standard Schema validator", async () => {
    const { defineCommand, runCommand, standardArgs } = await standard();
    const schema = v.strictObject({ name: v.pipe(v.string(), v.toUpperCase()) });
    const jsonSchema = {
      "~standard": {
        version: 1,
        jsonSchema: {
          input: () => ({
            $ref: "#/$defs/args",
            $defs: {
              args: {
                type: "object",
                additionalProperties: false,
                properties: { name: {} },
                required: ["name"],
              },
            },
          }),
        },
      },
    } as const;
    const command = defineCommand({
      name: "greet",
      args: standardArgs(schema, { jsonSchema }),
      run: ({ name }) => {
        expectTypeOf(name).toEqualTypeOf<string>();
        return name;
      },
    });
    expect(await runCommand(command, ["--name", "world"])).toMatchObject({
      success: true,
      result: "WORLD",
    });
    expect(await runCommand(command, ["--name", "world", "--extra"])).toMatchObject({
      success: false,
      error: { message: "Unknown flags: extra" },
    });
  });

  it("selects tagged branches without replacing the dedicated Zod adapter", async () => {
    const alias = await importSubpath<typeof ZodPolitty>("politty");
    const { defineCommand, runCommand } = await standard();
    const command = defineCommand({
      name: "toggle",
      args: z.discriminatedUnion("kind", [
        z.object({ kind: z.literal("read"), count: z.coerce.number() }),
        z.object({ kind: z.literal("write"), force: z.boolean() }),
      ]),
      run: (args) => (args.kind === "write" ? args.force : args.count),
    });
    expect(await runCommand(command, ["--force", "--kind", "write"])).toMatchObject({
      success: true,
      result: true,
    });
    expect(await runCommand(command, ["--count", "3", "--kind", "read"])).toMatchObject({
      success: true,
      result: 3,
    });

    const nativeCommand = alias.defineCommand({
      name: "native",
      args: z.object({ force: alias.arg(z.boolean(), { alias: "f" }) }),
      run: ({ force }) => force,
    });
    expect(await alias.runCommand(nativeCommand, ["-f"])).toMatchObject({
      success: true,
      result: true,
    });
  });
});
