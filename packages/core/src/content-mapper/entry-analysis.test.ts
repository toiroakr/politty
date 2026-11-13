import { afterAll, describe, expect, it } from "vitest";
import { API_PACKAGES, closeCorsa, loadCorsa } from "./corsa.js";
import { readGlobalArgs, type CodeFragment } from "./entry-analysis.js";

const render = (code: CodeFragment): string =>
  code
    .map((piece) =>
      typeof piece === "string" ? piece : `<${piece.dynamic ? "dynamic " : ""}${piece.specifier}>`,
    )
    .join("");

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
      expression: render(reference.expression),
      imports: reference.imports.map((binding) => binding.local).sort(),
      declarations: reference.declarations.map(render),
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
        `export const globalArgsSchema = z.object({
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
      `export type Level = "debug" | "info";`,
      "export const verbose = z.boolean();",
      `export function shape() {
  return { verbose, level: z.custom<Level>() };
}`,
      "export const schema = z.object(shape());",
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

  it("keeps a name bound in one nested scope free everywhere else", async () => {
    expect(
      await referenced(`import { z } from "zod";
import { runMain } from "politty";
import { level } from "./level";
runMain(cli, {
  globalArgs: z.object({
    value: z.string().transform((z) => z.trim()),
    level: z.custom((value) => { const level = value; return level; }).default(level),
  }),
});
`),
    ).toMatchObject({ imports: ["level", "z"] });
  });

  it("scopes infer type parameters to the extends clause and true branch", async () => {
    expect(
      await referenced(`import { runMain } from "politty";
import type { Mode, Box } from "./types";
type Unbox<T> = T extends Box<infer Mode> ? Mode : Mode;
runMain(cli, { globalArgs: schemaOf<Unbox<Box<string>>>() });
`),
    ).toMatchObject({
      imports: ["Box", "Mode"],
      declarations: ["export type Unbox<T> = T extends Box<infer Mode> ? Mode : Mode;"],
    });
  });

  it("copies destructuring declarations once, in declarator order", async () => {
    expect(
      (
        await referenced(`import { z } from "zod";
import { runMain } from "politty";
const { boolean, object } = z, unrelated = 1;
const base = z.string(), schema = object({ base, verbose: boolean() });
runMain(cli, { globalArgs: schema });
`)
      ).declarations,
    ).toEqual([
      "export const { boolean, object } = z;",
      "export const base = z.string();",
      "export const schema = object({ base, verbose: boolean() });",
    ]);
  });

  it("keeps the module specifiers of import types and dynamic imports apart", async () => {
    expect(
      await referenced(`import { runMain } from "politty";
type Mode = import("./types.js").Mode;
runMain(cli, { globalArgs: schemaFor<Mode>(await import("./schema.js")) });
`),
    ).toMatchObject({
      expression: "schemaFor<Mode>(await import(<dynamic ./schema.js>))",
      declarations: ["export type Mode = import(<./types.js>).Mode;"],
    });
  });

  it("follows a chain of options aliases without a fixed limit", async () => {
    expect(
      (
        await referenced(`import { runMain } from "politty";
const a = { globalArgs: schema };
const b = a, c = b, d = c, e = d, f = e;
runMain(cli, f);
`)
      ).expression,
    ).toBe("schema");
    expect(
      await read(`import { runMain } from "politty";\nconst a = b, b = a;\nrunMain(cli, a);`),
    ).toBeUndefined();
    expect(
      await read(
        `import { runMain } from "politty";\nconst { options } = { globalArgs: wrong, options: {} };\nrunMain(cli, options);`,
      ),
    ).toBeUndefined();
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

  it("ignores a globalArgs a later computed key or accessor may override", async () => {
    expect(
      await read(`import { runMain } from "politty";\nrunMain(cli, { globalArgs: a, [key]: b });`),
    ).toBeUndefined();
    expect(
      await read(
        `import { runMain } from "politty";\nrunMain(cli, { globalArgs: a, get globalArgs() { return b; } });`,
      ),
    ).toBeUndefined();
    expect(
      (
        await referenced(
          `import { runMain } from "politty";\nrunMain(cli, { [key]: b, globalArgs: a });`,
        )
      ).expression,
    ).toBe("a");
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
