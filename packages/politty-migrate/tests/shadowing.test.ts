import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { isDefaultRenderInitializer } from "../src/gen-config.js";
import { parseConfigSource, resolveConstInitializer } from "../src/parse-config.js";
import { rewriteSource } from "../src/rewrite.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf-8");

/** Find the initializer of the first `<key>: <identifier>` property assignment. */
function findIdentifier(
  sf: ts.SourceFile,
  key: string,
  identText: string,
): ts.Expression | undefined {
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node): void => {
    if (found) return;
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) &&
      node.name.text === key &&
      ts.isIdentifier(node.initializer) &&
      node.initializer.text === identText
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe("resolveConstInitializer top-level scoping", () => {
  it("ignores a same-named const nested in an earlier function body", () => {
    const src = `
function helper() {
  const myRender = createCommandRenderer({ headingLevel: 1 });
  return myRender;
}
const myRender = makeCustomRenderer();
`;
    const sf = parseConfigSource("a.ts", src).sourceFile;
    const init = resolveConstInitializer(sf, "myRender");
    expect(init?.getText(sf)).toBe("makeCustomRenderer()");
  });

  it("ignores a nested same-named `const files` and returns the top-level one", () => {
    const src = `
function collect() {
  const files = { unrelated: 1 };
  return files;
}
const files = { "docs/a.md": { title: "X", commands: ["x"] } };
`;
    const sf = parseConfigSource("b.ts", src).sourceFile;
    const init = resolveConstInitializer(sf, "files");
    expect(init?.getText(sf)).toContain("title");
  });

  it("refuses (returns undefined) when two top-level consts share the name", () => {
    const src = `
const x = createCommandRenderer({ headingLevel: 1 });
const x = makeCustomRenderer();
`;
    const sf = parseConfigSource("c.ts", src).sourceFile;
    expect(resolveConstInitializer(sf, "x")).toBeUndefined();
  });
});

describe("shadow-render fixture: custom render must NOT be silently dropped", () => {
  const text = read("fixtures/shadow-render/config.old.ts");
  const parsed = parseConfigSource("config.ts", text);
  const result = rewriteSource(
    parsed,
    parsed.calls.map((call) => ({ call })),
  );

  it("isDefaultRenderInitializer treats the resolved top-level custom binding as non-default", () => {
    const sf = parsed.sourceFile;
    // Sanity: the resolver picks the custom top-level `myRender`.
    expect(resolveConstInitializer(sf, "myRender")?.getText(sf)).toBe("makeCustomRenderer()");
    // The `render: myRender` identifier must resolve to the custom binding and
    // be classified as NOT default-equivalent (so its drop is flagged).
    const callExpr = parsed.calls[0]!;
    const filesProp = callExpr.properties.find((p) => p.name === "files");
    expect(filesProp).toBeDefined();
    const renderNode = findIdentifier(sf, "render", "myRender");
    expect(renderNode).toBeDefined();
    expect(isDefaultRenderInitializer(renderNode!, sf)).toBe(false);
  });

  it("emits a layout-review TODO for the custom render (not silently dropped)", () => {
    const reviews = result.todos.filter((t) => t.category === "layout-review");
    expect(reviews.length).toBeGreaterThanOrEqual(1);
    expect(result.text).toContain("// TODO(politty-migrate: layout-review)");
  });

  it("leaves no silent miss", () => {
    expect(result.silentMisses).toEqual([]);
  });
});

describe("shadow-files fixture: nested `const files` must not mask top-level", () => {
  const text = read("fixtures/shadow-files/config.old.ts");
  const parsed = parseConfigSource("config.ts", text);
  const result = rewriteSource(
    parsed,
    parsed.calls.map((call) => ({ call })),
  );

  it("migrates the real top-level `const files` (title -> layout)", () => {
    expect(result.text).not.toMatch(/^\s*title\s*:/m);
    expect(result.text).toContain("# Application Commands");
    expect(result.text).toContain("${md.commands()}");
  });

  it("leaves no silent miss", () => {
    expect(result.silentMisses).toEqual([]);
  });
});
