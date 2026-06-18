import { stripVTControlCharacters } from "node:util";

/**
 * Lightweight replacement for the `string-width` package.
 *
 * Computes the visual (terminal) width of a string by:
 *   1. Stripping ANSI escape codes (via Node's `stripVTControlCharacters`)
 *   2. Skipping zero-width characters (combining marks, control chars, etc.)
 *   3. Counting East Asian wide / fullwidth characters and most emoji as 2
 *   4. Counting everything else as 1
 *
 * This covers the cases the markdown renderer cares about (CJK text, emoji,
 * and already-styled ANSI strings) without pulling in an external dependency.
 */

/**
 * Whether a code point has no visual width (combining marks, zero-width
 * spaces/joiners, variation selectors, control characters).
 */
function isZeroWidth(cp: number): boolean {
  return (
    // C0/C1 control characters
    cp <= 0x1f ||
    (cp >= 0x7f && cp <= 0x9f) ||
    // Combining diacritical marks
    (cp >= 0x0300 && cp <= 0x036f) ||
    (cp >= 0x1ab0 && cp <= 0x1aff) ||
    (cp >= 0x1dc0 && cp <= 0x1dff) ||
    (cp >= 0x20d0 && cp <= 0x20ff) ||
    (cp >= 0xfe20 && cp <= 0xfe2f) ||
    // Zero-width space, ZWNJ, ZWJ, directional marks
    cp === 0x200b ||
    (cp >= 0x200c && cp <= 0x200f) ||
    cp === 0xfeff ||
    // Variation selectors
    (cp >= 0xfe00 && cp <= 0xfe0f) ||
    (cp >= 0xe0100 && cp <= 0xe01ef)
  );
}

/**
 * Whether a code point is rendered at double (full) width in a terminal.
 * Based on Unicode East Asian Width (Wide/Fullwidth) plus common emoji ranges.
 */
function isFullWidth(cp: number): boolean {
  return (
    // Hangul Jamo
    (cp >= 0x1100 && cp <= 0x115f) ||
    // CJK Radicals, Kangxi, symbols and punctuation
    (cp >= 0x2e80 && cp <= 0x303e) ||
    // Hiragana, Katakana, CJK strokes, Bopomofo, enclosed CJK
    (cp >= 0x3041 && cp <= 0x33ff) ||
    // CJK Unified Ideographs Extension A
    (cp >= 0x3400 && cp <= 0x4dbf) ||
    // CJK Unified Ideographs
    (cp >= 0x4e00 && cp <= 0x9fff) ||
    // Yi Syllables / Radicals
    (cp >= 0xa000 && cp <= 0xa4cf) ||
    // Hangul Jamo Extended-A
    (cp >= 0xa960 && cp <= 0xa97f) ||
    // Hangul Syllables
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    // CJK Compatibility Ideographs
    (cp >= 0xf900 && cp <= 0xfaff) ||
    // Vertical forms
    (cp >= 0xfe10 && cp <= 0xfe19) ||
    // CJK Compatibility Forms, Small Form Variants
    (cp >= 0xfe30 && cp <= 0xfe6f) ||
    // Fullwidth Forms
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    // Kana Supplement / Extended
    (cp >= 0x1b000 && cp <= 0x1b16f) ||
    // Enclosed Ideographic Supplement
    (cp >= 0x1f200 && cp <= 0x1f251) ||
    // CJK Unified Ideographs Extensions B–F and beyond
    (cp >= 0x20000 && cp <= 0x3fffd) ||
    // Emoji (Misc Symbols, Dingbats, Supplemental Symbols & Pictographs)
    (cp >= 0x2600 && cp <= 0x27bf) ||
    (cp >= 0x1f000 && cp <= 0x1faff)
  );
}

/**
 * Visual width of a single grapheme cluster (a user-perceived character).
 *
 * Iterating by code point would over-count multi-code-point clusters such as
 * ZWJ emoji sequences (👨‍👩‍👧), regional-indicator flags (🇯🇵), and emoji with
 * skin-tone modifiers (👍🏽). These render as a single glyph, so the whole
 * cluster contributes width 0/1/2 once.
 */
function graphemeWidth(grapheme: string): number {
  let hasVisible = false;
  let hasWide = false;

  for (const char of grapheme) {
    const cp = char.codePointAt(0)!;
    if (isZeroWidth(cp)) continue;
    hasVisible = true;
    if (isFullWidth(cp)) hasWide = true;
  }

  if (!hasVisible) return 0;
  return hasWide ? 2 : 1;
}

// `Intl.Segmenter` lets us iterate by grapheme cluster, but it may be missing
// in Node builds without full ICU. Probe once and fall back to per-code-point
// iteration so importing this module never throws.
const segmenter: Intl.Segmenter | undefined = (() => {
  try {
    return new Intl.Segmenter("en", { granularity: "grapheme" });
  } catch {
    return undefined;
  }
})();

/**
 * Compute the visual width of a string as rendered in a terminal.
 */
export default function stringWidth(input: string): number {
  if (input.length === 0) return 0;

  // ANSI/VT sequences start with ESC (\x1b) or the C1 CSI (\x9b).
  const str =
    input.includes("\x1b") || input.includes("\x9b") ? stripVTControlCharacters(input) : input;
  let width = 0;

  if (segmenter) {
    for (const { segment } of segmenter.segment(str)) {
      width += graphemeWidth(segment);
    }
  } else {
    // Fallback: iterate by code point. Multi-code-point clusters are
    // over-counted, but the module still loads and width stays usable.
    for (const char of str) {
      width += graphemeWidth(char);
    }
  }

  return width;
}
