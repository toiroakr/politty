import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRootLayout,
  escapeTemplateLiteral,
  generateCommandConfigs,
  isPureDefault,
  renderCommandMap,
} from "../src/gen-config.js";
import { parseOldDoc } from "../src/parse-doc.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf-8");

describe("isPureDefault", () => {
  it("treats an in-order, prose-free command as pure default", () => {
    const doc = parseOldDoc(read("fixtures/inline-array/README.old.md"));
    expect(isPureDefault(doc.commands[0]!)).toBe(true);
  });
});

describe("generateCommandConfigs", () => {
  it("emits `true` for pure-default commands", () => {
    const doc = parseOldDoc(read("fixtures/inline-array/README.old.md"));
    const cfgs = generateCommandConfigs(doc);
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]!.isDefault).toBe(true);
    expect(cfgs[0]!.code).toBe("true");
  });

  it("renders a CommandMap fragment", () => {
    const doc = parseOldDoc(read("fixtures/inline-array/README.old.md"));
    const map = renderCommandMap(generateCommandConfigs(doc));
    expect(map).toBe('{\n  "greet": true,\n}');
  });

  it("emits an override (not `true`) for a command carrying inter-section prose", () => {
    // Parser-driven: the custom-render fixture has a "> Note:" line between the
    // build command's usage and options markers. No manual injection.
    const doc = parseOldDoc(read("fixtures/custom-render/README.old.md"));
    const region = doc.commands[0]!;
    expect(region.scope).toBe("build");
    expect(isPureDefault(region)).toBe(false);

    const cfgs = generateCommandConfigs(doc);
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0]!.isDefault).toBe(false);
    const code = cfgs[0]!.code;
    expect(code).toContain("(md) =>");
    expect(code).toContain("${md.usage}");
    expect(code).toContain("${md.options}");
    expect(code).toContain("builds are incremental by default");
    // The prose is threaded BETWEEN usage and options, not appended at the end.
    expect(code.indexOf("${md.usage}")).toBeLessThan(code.indexOf("incremental"));
    expect(code.indexOf("incremental")).toBeLessThan(code.indexOf("${md.options}"));
  });
});

describe("escapeTemplateLiteral", () => {
  it("escapes backticks and template interpolations", () => {
    expect(escapeTemplateLiteral("a `b` ${c}")).toBe("a \\`b\\` \\${c}");
  });

  it("escapes backslashes first", () => {
    expect(escapeTemplateLiteral("a\\b")).toBe("a\\\\b");
  });
});

describe("buildRootLayout", () => {
  it("threads header free text, global options, index and commands", () => {
    const layout = buildRootLayout({
      freeText: ["# project-cli", "## Global Options"],
      hasGlobalOptions: true,
      hasIndex: true,
      includeCommands: true,
    });
    expect(layout).toContain("# project-cli");
    expect(layout).toContain("${md.globalOptions}");
    expect(layout).toContain("${md.index}");
    expect(layout).toContain("${md.commands()}");
    expect(layout.indexOf("${md.globalOptions}")).toBeLessThan(layout.indexOf("${md.index}"));
  });
});
