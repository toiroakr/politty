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
    it("should render # heading with bold + underline", () => {
      // sectionHeader = bold + underline (with color disabled, text is unchanged)
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
      expect(result).toBe("• Item one\n• Item two");
    });

    it("should not treat * as list marker", () => {
      // * at line start should be treated as paragraph with italic, not a list
      const result = renderMarkdown("* emphasized text *");
      expect(result).not.toContain("•");
    });

    it("should apply inline formatting in list items", () => {
      const result = renderMarkdown("- Use `--verbose` for **debug** output");
      expect(result).toBe("• Use --verbose for debug output");
    });
  });

  describe("ordered lists", () => {
    it("should render numbered items", () => {
      const result = renderMarkdown("1. First\n2. Second\n3. Third");
      expect(result).toBe("1. First\n2. Second\n3. Third");
    });

    it("should respect start number", () => {
      const result = renderMarkdown("3. Third\n4. Fourth");
      expect(result).toBe("3. Third\n4. Fourth");
    });

    it("should pad numbers for alignment", () => {
      const items = Array.from({ length: 10 }, (_, i) => `${i + 1}. Item ${i + 1}`).join("\n");
      const result = renderMarkdown(items);
      const lines = result.split("\n");
      // Single-digit numbers should be right-aligned with double-digit
      expect(lines[0]).toBe(" 1. Item 1");
      expect(lines[9]).toBe("10. Item 10");
    });

    it("should support ) delimiter", () => {
      const result = renderMarkdown("1) First\n2) Second");
      expect(result).toBe("1. First\n2. Second");
    });
  });

  describe("fenced code blocks", () => {
    it("should render a basic code block with backticks", () => {
      const md = "```\nconst x = 1;\nconsole.log(x);\n```";
      const result = renderMarkdown(md);
      expect(result).toBe("  const x = 1;\n  console.log(x);");
    });

    it("should render a code block with language specifier", () => {
      const md = "```js\nconst x = 1;\n```";
      const result = renderMarkdown(md);
      expect(result).toBe("  const x = 1;");
    });

    it("should render a code block with tilde fence", () => {
      const md = "~~~\nsome code\n~~~";
      const result = renderMarkdown(md);
      expect(result).toBe("  some code");
    });

    it("should preserve content literally (no inline processing)", () => {
      const md = "```\n**not bold** and `not code`\n```";
      const result = renderMarkdown(md);
      expect(result).toBe("  **not bold** and `not code`");
    });

    it("should preserve blank lines within code block", () => {
      const md = "```\nline 1\n\nline 3\n```";
      const result = renderMarkdown(md);
      expect(result).toBe("  line 1\n  \n  line 3");
    });

    it("should handle code block adjacent to other blocks", () => {
      const md = `Run the following:

\`\`\`sh
npm install
npm start
\`\`\`

Then open your browser.`;

      const result = renderMarkdown(md);
      const parts = result.split("\n\n");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("Run the following:");
      expect(parts[1]).toBe("  npm install\n  npm start");
      expect(parts[2]).toBe("Then open your browser.");
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

  describe("GitHub alerts", () => {
    it("should render [!NOTE] alert", () => {
      const md = "> [!NOTE]\n> This is a note.";
      const result = renderMarkdown(md);
      expect(result).toContain("ℹ");
      expect(result).toContain("Note");
      expect(result).toContain("│ This is a note.");
    });

    it("should render [!TIP] alert", () => {
      const md = "> [!TIP]\n> Use `--verbose` for more details.";
      const result = renderMarkdown(md);
      expect(result).toContain("💡");
      expect(result).toContain("Tip");
      expect(result).toContain("--verbose");
    });

    it("should render [!IMPORTANT] alert", () => {
      const md = "> [!IMPORTANT]\n> This step is required.";
      const result = renderMarkdown(md);
      expect(result).toContain("❗");
      expect(result).toContain("Important");
    });

    it("should render [!WARNING] alert", () => {
      const md = "> [!WARNING]\n> This may cause data loss.";
      const result = renderMarkdown(md);
      expect(result).toContain("⚠");
      expect(result).toContain("Warning");
    });

    it("should render [!CAUTION] alert", () => {
      const md = "> [!CAUTION]\n> Irreversible action.";
      const result = renderMarkdown(md);
      expect(result).toContain("🔴");
      expect(result).toContain("Caution");
    });

    it("should render alert without body", () => {
      const md = "> [!NOTE]";
      const result = renderMarkdown(md);
      expect(result).toContain("ℹ");
      expect(result).toContain("Note");
    });

    it("should render multi-line alert body", () => {
      const md = "> [!WARNING]\n> Line one.\n> Line two.";
      const result = renderMarkdown(md);
      expect(result).toContain("│ Line one.");
      expect(result).toContain("│ Line two.");
    });

    it("should not treat regular blockquote as alert", () => {
      const md = "> Just a regular quote.";
      const result = renderMarkdown(md);
      expect(result).not.toContain("ℹ");
      expect(result).toContain("│ Just a regular quote.");
    });

    it("should apply inline formatting in alert body", () => {
      const md = "> [!TIP]\n> Use `--dry-run` before **committing**.";
      const result = renderMarkdown(md);
      expect(result).toContain("--dry-run");
      expect(result).toContain("committing");
    });
  });

  describe("tables", () => {
    it("should render a basic table with borders", () => {
      const md = `| Name | Value |
|------|-------|
| foo  | 1     |
| bar  | 2     |`;
      const result = renderMarkdown(md);
      const lines = result.split("\n");
      // top border + header + mid border + 2 body rows + bottom border = 6
      expect(lines).toHaveLength(6);
      // Top border
      expect(lines[0]).toContain("┌");
      expect(lines[0]).toContain("┬");
      expect(lines[0]).toContain("┐");
      // Header
      expect(lines[1]).toContain("Name");
      expect(lines[1]).toContain("Value");
      // Mid border
      expect(lines[2]).toContain("├");
      expect(lines[2]).toContain("┼");
      expect(lines[2]).toContain("┤");
      // Body rows
      expect(lines[3]).toContain("foo");
      expect(lines[3]).toContain("1");
      expect(lines[4]).toContain("bar");
      expect(lines[4]).toContain("2");
      // Bottom border
      expect(lines[5]).toContain("└");
      expect(lines[5]).toContain("┴");
      expect(lines[5]).toContain("┘");
    });

    it("should pad columns to equal width", () => {
      const md = `| A | Longer |
|---|--------|
| x | y      |`;
      const result = renderMarkdown(md);
      const lines = result.split("\n");
      // Body row (index 3: top border, header, mid border, then body)
      expect(lines[3]).toContain("y     ");
    });

    it("should support right alignment", () => {
      const md = `| Name | Count |
|------|------:|
| foo  | 42    |
| bar  | 7     |`;
      const result = renderMarkdown(md);
      const lines = result.split("\n");
      // Right-aligned: " 7" should be padded left (body row at index 4)
      expect(lines[4]).toContain("    7");
    });

    it("should support center alignment", () => {
      const md = `| Name | Status |
|------|:------:|
| foo  | OK     |
| bar  | FAIL   |`;
      const result = renderMarkdown(md);
      expect(result).toContain("OK");
      expect(result).toContain("FAIL");
    });

    it("should support left alignment (explicit)", () => {
      const md = `| Name | Value |
|:-----|-------|
| foo  | 1     |`;
      const result = renderMarkdown(md);
      expect(result).toContain("foo");
    });

    it("should apply inline formatting in cells", () => {
      const md = `| Option | Description |
|--------|-------------|
| \`--verbose\` | Enable **debug** output |`;
      const result = renderMarkdown(md);
      expect(result).toContain("--verbose");
      expect(result).toContain("debug");
    });

    it("should handle missing cells gracefully", () => {
      const md = `| A | B | C |
|---|---|---|
| 1 | 2 |
| 4 | 5 | 6 |`;
      const result = renderMarkdown(md);
      const lines = result.split("\n");
      // top + header + mid + 2 body + bottom = 6
      expect(lines).toHaveLength(6);
      // Row with missing cell should fill empty and still have 3 columns
      // Count pipe separators (│) in each data row — should be 4 (outer left, 2 inner, outer right)
      const pipeCount = (s: string) => [...s].filter((c) => c === "│").length;
      expect(pipeCount(lines[1]!)).toBe(4); // header
      expect(pipeCount(lines[3]!)).toBe(4); // body row with missing cell
      expect(pipeCount(lines[4]!)).toBe(4); // body row with all cells
      // All border rows should have same length
      expect(lines[0]!.length).toBe(lines[2]!.length);
      expect(lines[0]!.length).toBe(lines[5]!.length);
    });

    it("should render table between other blocks", () => {
      const md = `Options table:

| Flag | Description |
|------|-------------|
| \`-v\` | Verbose     |

Use these flags as needed.`;
      const result = renderMarkdown(md);
      const parts = result.split("\n\n");
      expect(parts).toHaveLength(3);
      expect(parts[0]).toBe("Options table:");
      expect(parts[1]).toContain("Flag");
      expect(parts[2]).toBe("Use these flags as needed.");
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

    it("should render notes with code block", () => {
      const md = `## Configuration

Add the following to your config file:

\`\`\`json
{
  "port": 3000,
  "host": "localhost"
}
\`\`\`

Then restart the server with \`--reload\`.`;

      const result = renderMarkdown(md);
      expect(result).toContain("Configuration");
      expect(result).toContain('  "port": 3000,');
      expect(result).toContain("--reload");
    });
  });
});
