import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown-renderer.js";
import stringWidth from "./string-width.js";

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
  });

  describe("grapheme clusters", () => {
    it("should count a ZWJ emoji sequence as width 2", () => {
      // man + ZWJ + woman + ZWJ + girl
      expect(stringWidth("\u{1F468}‍\u{1F469}‍\u{1F467}")).toBe(2);
    });

    it("should count a regional-indicator flag as width 2", () => {
      expect(stringWidth("\u{1F1EF}\u{1F1F5}")).toBe(2); // 🇯🇵
    });

    it("should count an emoji with a skin-tone modifier as width 2", () => {
      expect(stringWidth("\u{1F44D}\u{1F3FD}")).toBe(2); // 👍🏽
    });

    it("should count a base character with a combining mark as width 1", () => {
      expect(stringWidth("é")).toBe(1); // e + combining acute accent
    });
  });

  describe("zero-width characters", () => {
    it("should ignore zero-width space and no-break space", () => {
      expect(stringWidth("a​b")).toBe(2); // zero-width space
      expect(stringWidth("a﻿b")).toBe(2); // zero-width no-break space (BOM)
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
| \u{1F468}‍\u{1F469}‍\u{1F467} | family |
| \u{1F1EF}\u{1F1F5} | japan |
| \u{1F44D}\u{1F3FD} | like |`;
    const result = renderMarkdown(md);
    const lines = result.split("\n");
    const firstLineWidth = stringWidth(lines[0]!);
    for (let i = 1; i < lines.length; i++) {
      expect(stringWidth(lines[i]!)).toBe(firstLineWidth);
    }
  });
});
