import { beforeEach, describe, expect, it } from "vitest";
import { setColorEnabled } from "./logger.js";
import { renderInline, renderMarkdown } from "./markdown-renderer.js";

// Disable color for predictable test output
beforeEach(() => {
  setColorEnabled(false);
});

describe("renderInline", () => {
  describe("inline code", () => {
    it("should render inline code", () => {
      expect(renderInline("Use `--verbose` flag")).toBe("Use --verbose flag");
    });

    it("should render multiple code spans", () => {
      expect(renderInline("`foo` and `bar`")).toBe("foo and bar");
    });

    it("should not process markdown inside code spans", () => {
      // Bold markers inside backticks should remain literal
      expect(renderInline("`**not bold**`")).toBe("**not bold**");
    });
  });

  describe("bold", () => {
    it("should render **bold**", () => {
      expect(renderInline("This is **important**")).toBe("This is important");
    });

    it("should render __bold__", () => {
      expect(renderInline("This is __important__")).toBe("This is important");
    });
  });

  describe("italic", () => {
    it("should render *italic*", () => {
      expect(renderInline("This is *emphasized*")).toBe("This is emphasized");
    });

    it("should render _italic_", () => {
      expect(renderInline("This is _emphasized_")).toBe("This is emphasized");
    });

    it("should not match underscores inside words", () => {
      expect(renderInline("foo_bar_baz")).toBe("foo_bar_baz");
    });
  });

  describe("links", () => {
    it("should render [text](url)", () => {
      expect(renderInline("See [docs](https://example.com)")).toBe(
        "See docs (https://example.com)",
      );
    });
  });

  describe("combined inline", () => {
    it("should handle bold and code together", () => {
      expect(renderInline("**Warning:** Use `--force`")).toBe("Warning: Use --force");
    });

    it("should handle italic and bold together", () => {
      expect(renderInline("*Note:* This is **critical**")).toBe("Note: This is critical");
    });
  });
});

describe("renderMarkdown", () => {
  describe("paragraphs", () => {
    it("should render a single paragraph", () => {
      expect(renderMarkdown("Hello world")).toBe("Hello world");
    });

    it("should reflow soft line breaks within a paragraph", () => {
      expect(renderMarkdown("Line one\nline two")).toBe("Line one line two");
    });

    it("should separate paragraphs with blank lines", () => {
      expect(renderMarkdown("First paragraph\n\nSecond paragraph")).toBe(
        "First paragraph\n\nSecond paragraph",
      );
    });
  });

  describe("headings", () => {
    it("should render # heading", () => {
      expect(renderMarkdown("# Title")).toBe("Title");
    });

    it("should render ## heading", () => {
      expect(renderMarkdown("## Section")).toBe("Section");
    });

    it("should render heading with inline formatting", () => {
      expect(renderMarkdown("## Using `--flag`")).toBe("Using --flag");
    });
  });

  describe("horizontal rules", () => {
    it("should render ---", () => {
      const result = renderMarkdown("---");
      expect(result).toBe("─".repeat(40));
    });

    it("should render ***", () => {
      const result = renderMarkdown("***");
      expect(result).toBe("─".repeat(40));
    });

    it("should render ___", () => {
      const result = renderMarkdown("___");
      expect(result).toBe("─".repeat(40));
    });
  });

  describe("blockquotes", () => {
    it("should render single-line blockquote", () => {
      expect(renderMarkdown("> Warning: Be careful")).toBe("│ Warning: Be careful");
    });

    it("should render multi-line blockquote", () => {
      const result = renderMarkdown("> Line 1\n> Line 2");
      expect(result).toBe("│ Line 1\n│ Line 2");
    });

    it("should apply inline formatting inside blockquote", () => {
      expect(renderMarkdown("> **Important:** Use `--flag`")).toBe("│ Important: Use --flag");
    });
  });

  describe("unordered lists", () => {
    it("should render - items", () => {
      const result = renderMarkdown("- Item one\n- Item two");
      expect(result).toBe("  • Item one\n  • Item two");
    });

    it("should render * items", () => {
      const result = renderMarkdown("* Item one\n* Item two");
      expect(result).toBe("  • Item one\n  • Item two");
    });

    it("should render + items", () => {
      const result = renderMarkdown("+ Item one\n+ Item two");
      expect(result).toBe("  • Item one\n  • Item two");
    });

    it("should apply inline formatting in list items", () => {
      const result = renderMarkdown("- Use `--verbose` for **debug** output");
      expect(result).toBe("  • Use --verbose for debug output");
    });
  });

  describe("ordered lists", () => {
    it("should render numbered items", () => {
      const result = renderMarkdown("1. First\n2. Second\n3. Third");
      expect(result).toBe("  1. First\n  2. Second\n  3. Third");
    });

    it("should respect start number", () => {
      const result = renderMarkdown("3. Third\n4. Fourth");
      expect(result).toBe("  3. Third\n  4. Fourth");
    });

    it("should pad numbers for alignment", () => {
      const items = Array.from({ length: 10 }, (_, i) => `${i + 1}. Item ${i + 1}`).join("\n");
      const result = renderMarkdown(items);
      const lines = result.split("\n");
      // Single-digit numbers should be right-aligned with double-digit
      expect(lines[0]).toBe("   1. Item 1");
      expect(lines[9]).toBe("  10. Item 10");
    });

    it("should support ) delimiter", () => {
      const result = renderMarkdown("1) First\n2) Second");
      expect(result).toBe("  1. First\n  2. Second");
    });
  });

  describe("mixed blocks", () => {
    it("should render heading + paragraph + list", () => {
      const md = `## Configuration

Set the following options:

- \`--port\` to specify the port
- \`--host\` to specify the host`;

      const result = renderMarkdown(md);
      const parts = result.split("\n\n");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("Configuration");
      expect(parts[1]).toBe("Set the following options:");
      expect(parts[2]).toContain("• --port to specify the port");
      expect(parts[2]).toContain("• --host to specify the host");
    });

    it("should render blockquote + paragraph", () => {
      const md = `> **Warning:** This is destructive.

Use \`--dry-run\` to preview changes first.`;

      const result = renderMarkdown(md);
      const parts = result.split("\n\n");
      expect(parts).toHaveLength(2);
      expect(parts[0]).toBe("│ Warning: This is destructive.");
      expect(parts[1]).toBe("Use --dry-run to preview changes first.");
    });

    it("should render list + hr + paragraph", () => {
      const md = `- Option A
- Option B

---

Choose one of the above options.`;

      const result = renderMarkdown(md);
      const parts = result.split("\n\n");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toContain("• Option A");
      expect(parts[1]).toBe("─".repeat(40));
      expect(parts[2]).toBe("Choose one of the above options.");
    });
  });

  describe("realistic CLI notes", () => {
    it("should render a typical notes section", () => {
      const md = `**Warning:** This operation is destructive and cannot be undone.

Set \`NODE_ENV\` to \`production\` for optimized output.
See [documentation](https://example.com/docs) for more details.

Available actions:
- \`create\` — Create a new resource
- \`delete\` — Delete an existing resource
- \`list\` — List all resources`;

      const result = renderMarkdown(md);
      expect(result).toContain("Warning:");
      expect(result).toContain("NODE_ENV");
      expect(result).toContain("production");
      expect(result).toContain("documentation (https://example.com/docs)");
      expect(result).toContain("• create — Create a new resource");
    });
  });
});
