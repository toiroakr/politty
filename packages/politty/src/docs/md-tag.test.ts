import { describe, expect, it } from "vitest";
import { formatTemplate } from "./md-tag.js";

/**
 * Helper to drive formatTemplate like a tagged template literal.
 *
 * Intentionally NOT named `md`: the `md` tag is treated as embedded Markdown by
 * the formatter (oxfmt), which would reformat these adversarial whitespace
 * fixtures and defeat the tests.
 */
function tpl(strings: TemplateStringsArray, ...values: unknown[]): string {
  return formatTemplate(strings, values);
}

describe("formatTemplate (md tag core)", () => {
  it("strips common leading indentation (dedent)", () => {
    const out = tpl`
      # Title

      body
    `;
    expect(out).toBe("# Title\n\nbody");
  });

  it("trims leading and trailing blank lines", () => {
    const out = tpl`

      hello

    `;
    expect(out).toBe("hello");
  });

  it("collapses 3+ consecutive newlines into a single blank line", () => {
    const out = tpl`
      a



      b
    `;
    expect(out).toBe("a\n\nb");
  });

  it("closes the gap when an interpolated value is empty", () => {
    const args = "";
    const usage = "**Usage**";
    const out = tpl`
      ${args}

      ${usage}
    `;
    // empty args must not leave a triple blank line / leading gap
    expect(out).toBe("**Usage**");
  });

  it("keeps a single blank line between non-empty sections", () => {
    const usage = "**Usage**\n\n```\ncmd\n```";
    const options = "**Options**\n\n| ... |";
    const out = tpl`
      ${usage}

      ${options}
    `;
    expect(out).toBe("**Usage**\n\n```\ncmd\n```\n\n**Options**\n\n| ... |");
  });

  it("does not corrupt multi-line interpolated content at column 0", () => {
    const block = "line1\nline2\nline3";
    const out = tpl`
      intro

      ${block}
    `;
    expect(out).toBe("intro\n\nline1\nline2\nline3");
  });

  it("preserves indentation inside fenced code relative to dedent base", () => {
    const out = tpl`
      **Usage**

      \`\`\`
      cmd --flag
      \`\`\`
    `;
    expect(out).toBe("**Usage**\n\n```\ncmd --flag\n```");
  });

  it("handles a single-line template without newlines", () => {
    const name = "deploy";
    const out = tpl`## ${name}`;
    expect(out).toBe("## deploy");
  });
});
