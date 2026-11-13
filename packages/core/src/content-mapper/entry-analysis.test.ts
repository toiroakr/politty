import { afterAll, describe, expect, it } from "vitest";
import { API_PACKAGES, closeCorsa, loadCorsa } from "./corsa.js";
import { readGlobalArgs } from "./entry-analysis.js";

afterAll(() => closeCorsa());

describe.each(API_PACKAGES)("readGlobalArgs with %s", (packageName) => {
  async function read(source: string) {
    const corsa = await loadCorsa(import.meta.dirname, packageName);
    if (!corsa) throw new Error(`${packageName} is not installed`);
    const lease = corsa.api.createSourceFile("/project/src/main.ts", source);
    try {
      return readGlobalArgs(corsa.ast, lease.sourceFile);
    } finally {
      lease.dispose();
    }
  }

  async function referenced(source: string) {
    const reference = await read(source);
    if (!reference) throw new Error("no globalArgs found");
    return {
      expression: reference.expression,
      imports: reference.imports.map((binding) => binding.local).sort(),
      declarations: reference.declarations,
    };
  }

  it("copies a schema declared in the entry and the imports it uses", async () => {
    expect(
      await referenced(`import { z } from "zod";
import { arg, defineCommand, runMain } from "politty";

/** The global options */
export const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
});
const cli = defineCommand({ name: "app" });
runMain(cli, { version: "1.0.0", globalArgs: globalArgsSchema });
`),
    ).toEqual({
      expression: "globalArgsSchema",
      imports: ["arg", "z"],
      declarations: [
        `const globalArgsSchema = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
});`,
      ],
    });
  });

  it("copies an inline expression and only the imports it references", async () => {
    expect(
      await referenced(`import { defineCommand, runMain } from "@politty/zod";
import { z } from "zod";
import { commonArgs } from "./shared/args";

void runMain(main, {
  version: packageJson.version,
  globalArgs: z.strictObject(commonArgs),
  setup: ({ agent }) => {
    console.log(agent);
  },
});
`),
    ).toEqual({
      expression: "z.strictObject(commonArgs)",
      imports: ["commonArgs", "z"],
      declarations: [],
    });
  });

  it("follows declarations transitively and copies only the declarator used", async () => {
    expect(
      (
        await referenced(`import { z } from "zod";
import { runMain } from "politty";
type Level = "debug" | "info";
export const verbose = z.boolean(), unused = 1;
export function shape() {
  return { verbose, level: z.custom<Level>() };
}
const schema = z.object(shape());
runMain(cli, { globalArgs: schema });
`)
      ).declarations,
    ).toEqual([
      `type Level = "debug" | "info";`,
      "const verbose = z.boolean();",
      `function shape() {
  return { verbose, level: z.custom<Level>() };
}`,
      "const schema = z.object(shape());",
    ]);
  });

  it("leaves out names the expression binds itself, members and object keys", async () => {
    expect(
      await referenced(`import { z } from "zod";
import { runMain } from "politty";
import { verbose, config, other } from "./names";
const value = 1;
runMain(cli, {
  globalArgs: z.object({ verbose, config: z.string(), other: [1].map((value) => value)[0] && z.number() }).describe(other.name),
});
`),
    ).toMatchObject({ imports: ["other", "verbose", "z"], declarations: [] });
  });

  it("reads globalArgs from an options object held in a variable", async () => {
    expect(
      (
        await referenced(`import { runMain } from "politty";
const options = { version: "1", globalArgs: schema } satisfies object;
runMain(cli, options);
`)
      ).expression,
    ).toBe("schema");
  });

  it("accepts shorthand properties, renamed imports and namespace imports", async () => {
    expect(
      (await referenced(`import { runMain as run } from "politty";\nrun(cli, { globalArgs });`))
        .expression,
    ).toBe("globalArgs");
    expect(
      (
        await referenced(
          `import * as politty from "politty";\nawait politty.runMain(cli, { "globalArgs": schema });`,
        )
      ).expression,
    ).toBe("schema");
  });

  it("finds the call inside blocks and copies type-only and attributed imports", async () => {
    const reference = await read(`import type { Shape } from "./types";
import { type Mode, runMain } from "politty";
import defaults from "./defaults.json" with { type: "json" };
if (import.meta.main) {
  runMain(cli, { globalArgs: z.object(defaults as Shape) as unknown as Mode });
}
`);
    expect(reference?.imports).toEqual([
      expect.objectContaining({ local: "Shape", typeOnly: true, specifier: "./types" }),
      expect.objectContaining({ local: "Mode", typeOnly: true, specifier: "politty" }),
      expect.objectContaining({
        local: "defaults",
        imported: "default",
        attributes: 'with { type: "json" }',
      }),
    ]);
  });

  it("ignores a globalArgs a later spread may override, and calls it cannot attribute to runMain", async () => {
    expect(
      await read(
        `import { runMain } from "politty";\nrunMain(cli, { globalArgs: schema, ...rest });`,
      ),
    ).toBeUndefined();
    expect(await read(`runMain(cli, { globalArgs: schema });`)).toBeUndefined();
    expect(
      await read(`import type { runMain } from "politty";\nrunMain(cli, { globalArgs: schema });`),
    ).toBeUndefined();
    expect(
      await read(
        `import { runMain } from "politty";\nother.runMain(cli, { globalArgs: schema });\nrunMain(cli);`,
      ),
    ).toBeUndefined();
  });
});
