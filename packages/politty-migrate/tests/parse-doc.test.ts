import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseOldDoc } from "../src/parse-doc.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf-8");

describe("parseOldDoc", () => {
  it("decomposes a pure-default command into ordered sections", () => {
    const doc = parseOldDoc(read("fixtures/inline-array/README.old.md"));
    expect(doc.isOldFormat).toBe(true);
    expect(doc.commands).toHaveLength(1);
    const cmd = doc.commands[0]!;
    expect(cmd.scope).toBe("greet");
    expect(cmd.sections.map((s) => s.type)).toEqual([
      "heading",
      "description",
      "usage",
      "arguments",
      "options",
    ]);
    expect(cmd.sections[0]!.content).toBe("# greet");
    expect(cmd.sections[1]!.content).toBe("Greet someone");
    expect(cmd.interSectionText).toBe("");
  });

  it("attaches free text interleaved between a command's section markers to that command", () => {
    const doc = parseOldDoc(read("fixtures/custom-render/README.old.md"));
    expect(doc.commands).toHaveLength(1);
    const build = doc.commands[0]!;
    expect(build.scope).toBe("build");
    // The "> Note:" prose sits between this command's usage:end and
    // options:start markers, so it belongs to the command, not file-level.
    expect(build.interSectionText).toContain("incremental");
    expect(build.interSectionChunks).toHaveLength(1);
    expect(build.interSectionChunks[0]!.text).toContain("incremental");
    // It must NOT leak to file-level free text.
    expect(doc.freeText.some((f) => f.text.includes("incremental"))).toBe(false);
    // The chunk is positioned between the usage and options sections.
    const usage = build.sections.find((s) => s.type === "usage")!;
    const options = build.sections.find((s) => s.type === "options")!;
    expect(build.interSectionChunks[0]!.position).toBeGreaterThan(usage.position);
    expect(build.interSectionChunks[0]!.position).toBeLessThan(options.position);
  });

  it("parses root-header, global-options and index file elements", () => {
    const doc = parseOldDoc(read("fixtures/rootdoc-globalopts/REFERENCE.old.md"));
    expect(doc.isOldFormat).toBe(true);
    expect(doc.file.rootHeader).toContain("# project-cli");
    expect(doc.file.globalOptions).toContain("--verbose");
    expect(doc.file.globalOptions).toContain('<a id="global-options"></a>');
    expect(doc.file.index).toContain("init");
    // The "## Global Options" / "## Command Reference" prose is free text.
    const prose = doc.freeText.map((f) => f.text).join("\n");
    expect(prose).toContain("## Global Options");
    expect(prose).toContain("## Command Reference");
  });

  it("returns isOldFormat=false for a markerless document", () => {
    const doc = parseOldDoc("# hello\n\njust prose\n");
    expect(doc.isOldFormat).toBe(false);
    expect(doc.commands).toHaveLength(0);
  });

  it("handles empty scope (root command)", () => {
    const doc = parseOldDoc(read("fixtures/integration/README.old.md"));
    expect(doc.commands).toHaveLength(1);
    expect(doc.commands[0]!.scope).toBe("");
    expect(doc.commands[0]!.sections.map((s) => s.type)).toEqual([
      "heading",
      "description",
      "usage",
      "arguments",
      "options",
    ]);
  });
});
