import { describe, expect, it } from "vitest";
import { analyzeEntry, referencedBindings } from "./entry-analysis.js";
import { tokenize } from "./lexer.js";

function referenced(source: string) {
  const analysis = analyzeEntry(source);
  const call = analysis.calls[0];
  if (!call) throw new Error("no globalArgs call found");
  const { imports, declarations } = referencedBindings(analysis, call.tokens);
  return {
    expression: call.expression,
    imports: imports.map((binding) => binding.local).sort(),
    declarations: declarations.map((declaration) => declaration.text),
  };
}

describe("tokenize", () => {
  it("drops comments and keeps strings, templates and regexes whole", () => {
    const tokens = tokenize(
      'const a = "x // y"; // comment\n/* block */ const b = `t ${a + `n ${1}`} e`; const r = /[/]x/g;',
    );
    expect(tokens.map((token) => token.value)).toEqual([
      "const",
      "a",
      "=",
      '"x // y"',
      ";",
      "const",
      "b",
      "=",
      "`t ${",
      "a",
      "+",
      "`n ${",
      "1",
      "}`",
      "} e`",
      ";",
      "const",
      "r",
      "=",
      "/[/]x/g",
      ";",
    ]);
  });

  it("reads a slash after an expression as division", () => {
    expect(tokenize("a / b / c").map((token) => token.kind)).toEqual([
      "identifier",
      "punctuator",
      "identifier",
      "punctuator",
      "identifier",
    ]);
  });
});

describe("analyzeEntry", () => {
  it("finds a schema declared in the entry", () => {
    expect(
      referenced(`import { z } from "zod";
import { arg, defineCommand, runMain } from "politty";

const globalArgsSchema = z.object({
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

  it("copies an inline expression and the imports it uses", () => {
    expect(
      referenced(`import { defineCommand, runMain } from "@politty/zod";
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

  it("follows declarations transitively and copies only the declarator used", () => {
    expect(
      referenced(`import { z } from "zod";
import { runMain } from "politty";
export const verbose = z.boolean(), unused = 1;
function shape() {
  return { verbose };
}
const schema = z.object(shape());
runMain(cli, { globalArgs: schema });
`).declarations,
    ).toEqual([
      "const verbose = z.boolean();",
      `function shape() {
  return { verbose };
}`,
      "const schema = z.object(shape());",
    ]);
  });

  it("reads globalArgs from an options object held in a variable", () => {
    expect(
      referenced(`import { runMain } from "politty";
const options = { version: "1", globalArgs: schema } as const;
runMain(cli, options);
`).expression,
    ).toBe("schema");
  });

  it("accepts shorthand properties, renamed imports and namespace imports", () => {
    expect(
      referenced(`import { runMain as run } from "politty";
run(cli, { globalArgs });`).expression,
    ).toBe("globalArgs");
    expect(
      referenced(`import * as politty from "politty";
await politty.runMain(cli, { globalArgs: schema });`).expression,
    ).toBe("schema");
  });

  it("ignores a globalArgs a later spread may override", () => {
    expect(
      analyzeEntry(`import { runMain } from "politty";
runMain(cli, { globalArgs: schema, ...rest });`).calls,
    ).toEqual([]);
  });

  it("ignores runMain calls it cannot attribute to an import", () => {
    expect(analyzeEntry(`runMain(cli, { globalArgs: schema });`).calls).toEqual([]);
    expect(
      analyzeEntry(`import { runMain } from "politty";
other.runMain(cli, { globalArgs: schema });
runMain(cli);`).calls,
    ).toEqual([]);
  });

  it("parses default, namespace, type-only and attributed imports", () => {
    const { imports } = analyzeEntry(`import pkg, * as ns from "./pkg.js";
import type { A, B as C } from "./types";
import { type D, E } from "./mixed";
import data from "./data.json" with { type: "json" };
import "./side-effect";
`);
    expect([...imports.values()]).toEqual([
      {
        local: "pkg",
        imported: "default",
        typeOnly: false,
        specifier: "./pkg.js",
        attributes: undefined,
      },
      { local: "ns", imported: "*", typeOnly: false, specifier: "./pkg.js", attributes: undefined },
      { local: "A", imported: "A", typeOnly: true, specifier: "./types", attributes: undefined },
      { local: "C", imported: "B", typeOnly: true, specifier: "./types", attributes: undefined },
      { local: "D", imported: "D", typeOnly: true, specifier: "./mixed", attributes: undefined },
      { local: "E", imported: "E", typeOnly: false, specifier: "./mixed", attributes: undefined },
      {
        local: "data",
        imported: "default",
        typeOnly: false,
        specifier: "./data.json",
        attributes: 'with { type: "json" }',
      },
    ]);
  });

  it("ends declarations without semicolons where a new statement starts", () => {
    const { declarations } = analyzeEntry(`const a = z
  .string()
  .optional()
const b: Record<string, number> = {}
export class Box<T> { value?: T }
enum Mode { A, B }
`);
    expect([...declarations.values()].map((declaration) => declaration.text)).toEqual([
      `const a = z
  .string()
  .optional();`,
      "const b: Record<string, number> = {};",
      "class Box<T> { value?: T }",
      "enum Mode { A, B }",
    ]);
  });
});
