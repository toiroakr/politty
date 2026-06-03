import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseConfigSource } from "../src/parse-config.js";
import { rewriteSource, scanSilentMisses } from "../src/rewrite.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf-8");

describe("variable-referenced `const files` migration", () => {
  const text = read("fixtures/files-var-ref/config.old.ts");
  const parsed = parseConfigSource("config.ts", text);
  const result = rewriteSource(
    parsed,
    parsed.calls.map((call) => ({ call })),
  );
  const out = result.text;

  it("resolves the same-file `const files` and migrates its FileConfig entries", () => {
    // No removed FileConfig key survives in a property position.
    expect(out).not.toMatch(/^\s*title\s*:/m);
    expect(out).not.toMatch(/^\s*description\s*:/m);
    expect(out).not.toMatch(/^\s*render\s*:/m);
  });

  it("converts title/description into a `layout` ending with md.commands()", () => {
    expect(out).toContain("layout: (md) =>");
    expect(out).toContain("# Application Commands");
    expect(out).toContain("Commands for managing applications");
    expect(out).toContain("${md.commands()}");
    // The third entry has no description: layout has heading + commands only.
    expect(out).toContain("# Custom Commands");
  });

  it("preserves non-removed keys (commands) verbatim", () => {
    expect(out).toContain('commands: ["init", "deploy"]');
    expect(out).toContain('commands: ["query"]');
    expect(out).toContain('commands: ["custom"]');
  });

  it("drops default-equivalent render (const + inline) with NO TODO", () => {
    // `defaultRender` resolves to createCommandRenderer({headingLevel:1}) and the
    // inline createCommandRenderer({headingLevel:1}) are both default-equivalent.
    // The custom `makeFancyRenderer()` IS flagged, so exactly one layout-review.
    const reviews = result.todos.filter((t) => t.category === "layout-review");
    expect(reviews).toHaveLength(1);
    expect(reviews[0]!.detail).toMatch(/custom `render`/);
  });

  it("emits a layout-review anchor next to the custom-render entry", () => {
    expect(out).toContain("// TODO(politty-migrate: layout-review)");
    // The custom renderer is REMOVED from the literal (default blocks kept);
    // the TODO is what carries the reproduction guidance, not the source.
    expect(out).not.toContain("makeFancyRenderer");
    // Anchor sits above the custom.md entry.
    const customIdx = out.indexOf('"docs/cli/custom.md"');
    const anchorIdx = out.lastIndexOf("// TODO(politty-migrate: layout-review)", customIdx);
    expect(anchorIdx).toBeGreaterThan(-1);
  });

  it("NO SILENT MISS: every removed key is converted or TODO-anchored", () => {
    // The defining invariant: after rewrite, no removed key remains without a
    // nearby TODO. The custom-render entry KEPT no removed key (render dropped)
    // and HAS a layout-review anchor, so silentMisses is empty.
    expect(result.silentMisses).toEqual([]);
  });
});

describe("scanSilentMisses (NO-SILENT-MISS guard)", () => {
  it("flags a leftover removed key with NO nearby TODO", () => {
    const bad = `const files = {
  "docs/a.md": {
    title: "Left Behind",
    commands: ["x"],
  },
};`;
    const misses = scanSilentMisses(bad);
    expect(misses.map((m) => m.key)).toContain("title");
  });

  it("does NOT flag a removed key that has a nearby TODO anchor", () => {
    const ok = `const files = {
  // TODO(politty-migrate: layout-review) finish this
  "docs/a.md": {
    title: "Covered",
    commands: ["x"],
  },
};`;
    expect(scanSilentMisses(ok)).toEqual([]);
  });

  it("does NOT false-positive on the words inside a generated layout string", () => {
    const ok = `const files = {
  "docs/a.md": {
    commands: ["x"],
    layout: (md) => md\`
      # title and description live here as prose, render too
      \${md.commands()}
    \`,
  },
};`;
    expect(scanSilentMisses(ok)).toEqual([]);
  });
});
