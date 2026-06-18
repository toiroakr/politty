import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown-renderer.js";
import stringWidth from "./string-width.js";

// Invisible / multi-code-point sequences, spelled with explicit escapes so the
// intent stays clear and editors/formatters can't silently alter them.
const ZWJ = "\u200D";
const FAMILY = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`; // 👨‍👩‍👧
const FLAG_JP = "\u{1F1EF}\u{1F1F5}"; // 🇯🇵
const THUMBS_UP_TONE = "\u{1F44D}\u{1F3FD}"; // 👍🏽
const E_ACUTE_COMBINING = "e\u0301"; // é (e + combining acute accent)
const ZERO_WIDTH_SPACE = "\u200B";
const ZERO_WIDTH_NO_BREAK_SPACE = "\uFEFF"; // BOM

describe("stringWidth", () => {
  it("should return 0 for an empty string", () => {
    expect(stringWidth("")).toBe(0);
  });

  it("should count ASCII characters as width 1 each", () => {
    expect(stringWidth("hello")).toBe(5);
  });

  it("should count East Asian full-width characters as width 2 each", () => {
    expect(stringWidth("あいう")).toBe(6);
    expect(stringWidth("名前")).toBe(4);
    // Fullwidth forms
    expect(stringWidth("ＡＢ")).toBe(4);
  });

  it("should ignore ANSI escape codes", () => {
    expect(stringWidth("\x1b[31mred\x1b[0m")).toBe(3);
    expect(stringWidth("\x1b[1m\x1b[32mok\x1b[0m")).toBe(2);
    // C1 CSI control sequence
    expect(stringWidth("\x9b31mred\x9b0m")).toBe(3);
  });

  describe("grapheme clusters", () => {
    it("should count a ZWJ emoji sequence as width 2", () => {
      expect(stringWidth(FAMILY)).toBe(2);
    });

    it("should count a regional-indicator flag as width 2", () => {
      expect(stringWidth(FLAG_JP)).toBe(2);
    });

    it("should count an emoji with a skin-tone modifier as width 2", () => {
      expect(stringWidth(THUMBS_UP_TONE)).toBe(2);
    });

    it("should count a base character with a combining mark as width 1", () => {
      expect(stringWidth(E_ACUTE_COMBINING)).toBe(1);
    });
  });

  describe("zero-width characters", () => {
    it("should ignore zero-width space and no-break space", () => {
      expect(stringWidth(`a${ZERO_WIDTH_SPACE}b`)).toBe(2);
      expect(stringWidth(`a${ZERO_WIDTH_NO_BREAK_SPACE}b`)).toBe(2);
    });

    it("should ignore control characters", () => {
      expect(stringWidth("a\tb")).toBe(2);
    });
  });
});

describe("table alignment with grapheme clusters", () => {
  it("should keep borders and rows at equal visual width with emoji cells", () => {
    const md = `| Icon | Label |
|------|-------|
| ${FAMILY} | family |
| ${FLAG_JP} | japan |
| ${THUMBS_UP_TONE} | like |`;
    const result = renderMarkdown(md);
    const lines = result.split("\n");
    const firstLineWidth = stringWidth(lines[0]!);
    for (let i = 1; i < lines.length; i++) {
      expect(stringWidth(lines[i]!)).toBe(firstLineWidth);
    }
  });
});
