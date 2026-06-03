import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseConfigSource } from "../src/parse-config.js";
import { applyEdits, rewriteSource } from "../src/rewrite.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf-8");

describe("parseConfigSource", () => {
  it("finds assertDocMatch and extracts properties", () => {
    const text = read("fixtures/inline-array/config.old.ts");
    const { calls } = parseConfigSource("config.ts", text);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.callName).toBe("assertDocMatch");
    expect(calls[0]!.isObjectLiteral).toBe(true);
    expect(calls[0]!.properties.map((p) => p.name).sort()).toEqual(["command", "files"]);
  });

  it("flags a spread of a base config", () => {
    const text = read("fixtures/spread-base/config.old.ts");
    const { calls } = parseConfigSource("config.ts", text);
    expect(calls[0]!.spreads).toContain("baseConfig");
    expect(calls[0]!.dynamic.some((d) => d.reason === "spread-config")).toBe(true);
  });

  it("flags a variable-ref config (non-literal arg)", () => {
    const text = read("fixtures/variable-ref/config.old.ts");
    const { calls } = parseConfigSource("config.ts", text);
    expect(calls[0]!.isObjectLiteral).toBe(false);
    expect(calls[0]!.dynamic.some((d) => d.reason === "variable-ref")).toBe(true);
  });
});

describe("applyEdits", () => {
  it("applies non-overlapping edits right-to-left", () => {
    const out = applyEdits("0123456789", [
      { start: 0, end: 1, replacement: "A" },
      { start: 5, end: 6, replacement: "F" },
    ]);
    expect(out).toBe("A1234F6789");
  });
});

describe("rewriteSource", () => {
  it("inserts a spread-config TODO anchor", () => {
    const text = read("fixtures/spread-base/config.old.ts");
    const parsed = parseConfigSource("config.ts", text);
    const { text: out, todos } = rewriteSource(
      parsed,
      parsed.calls.map((call) => ({ call })),
    );
    expect(todos.some((t) => t.category === "spread-config")).toBe(true);
    expect(out).toContain("// TODO(politty-migrate: spread-config)");
  });

  it("inserts a variable-ref TODO anchor", () => {
    const text = read("fixtures/variable-ref/config.old.ts");
    const parsed = parseConfigSource("config.ts", text);
    const { text: out, todos } = rewriteSource(
      parsed,
      parsed.calls.map((call) => ({ call })),
    );
    expect(todos.some((t) => t.category === "variable-ref")).toBe(true);
    expect(out).toContain("// TODO(politty-migrate: variable-ref)");
  });

  it("removes rootInfo and leaves a layout-review TODO", () => {
    const text = read("fixtures/rootdoc-globalopts/config.old.ts");
    const parsed = parseConfigSource("config.ts", text);
    const { text: out, todos } = rewriteSource(
      parsed,
      parsed.calls.map((call) => ({ call })),
    );
    // The `rootInfo:` property is removed (the only remaining mention is in
    // the TODO anchor comment).
    expect(out).not.toMatch(/rootInfo\s*:/);
    expect(out).not.toContain("Project management CLI demonstrating");
    expect(todos.some((t) => t.category === "layout-review")).toBe(true);
  });

  it("flags removed FileConfig keys (title/description/render) for review", () => {
    const text = read("fixtures/custom-render/config.old.ts");
    const parsed = parseConfigSource("config.ts", text);
    const { todos } = rewriteSource(
      parsed,
      parsed.calls.map((call) => ({ call })),
    );
    const review = todos.find((t) => t.category === "layout-review");
    expect(review).toBeDefined();
    expect(review!.detail).toMatch(/title|description|render/);
  });

  it("rewrites the files value to a CommandMap when provided", () => {
    const text = read("fixtures/inline-array/config.old.ts");
    const parsed = parseConfigSource("config.ts", text);
    const { text: out } = rewriteSource(parsed, [
      {
        call: parsed.calls[0]!,
        filesValue: '{ "tests/.../README.md": { "greet": true } }',
      },
    ]);
    expect(out).toContain('"greet": true');
  });
});
