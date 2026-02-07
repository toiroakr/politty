import { styles } from "./logger.js";

/**
 * Lightweight Markdown-to-terminal renderer.
 *
 * Supports a subset of Markdown tailored for CLI help notes:
 * - Inline: bold, italic, inline code, links
 * - Block: paragraphs, unordered/ordered lists, blockquotes, headings, horizontal rules
 */

/**
 * Apply inline Markdown formatting to a string.
 *
 * Processing order matters to avoid conflicts:
 *   1. Inline code (backticks) — content inside is literal, no further processing
 *   2. Bold (**text**)
 *   3. Italic (*text* or _text_)
 *   4. Links [text](url)
 */
export function renderInline(text: string): string {
  // 1. Protect inline code spans — extract them, replace with placeholders, restore later
  const codeSpans: string[] = [];
  let result = text.replace(/`([^`]+)`/g, (_match, code: string) => {
    const index = codeSpans.length;
    codeSpans.push(styles.cyan(code));
    return `\x00CODE${index}\x00`;
  });

  // 2. Bold: **text** or __text__
  result = result.replace(/\*\*(.+?)\*\*/g, (_match, content: string) => styles.bold(content));
  result = result.replace(/__(.+?)__/g, (_match, content: string) => styles.bold(content));

  // 3. Italic: *text* or _text_
  //    Negative lookbehind/lookahead to avoid matching inside words for underscore
  result = result.replace(/\*(.+?)\*/g, (_match, content: string) => styles.italic(content));
  result = result.replace(/(?<!\w)_(.+?)_(?!\w)/g, (_match, content: string) =>
    styles.italic(content),
  );

  // 4. Links: [text](url)
  result = result.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_match, linkText: string, url: string) =>
      `${styles.underline(linkText)} ${styles.dim(`(${url})`)}`,
  );

  // Restore code spans
  result = result.replace(
    /\x00CODE(\d+)\x00/g,
    (_match, index: string) => codeSpans[Number(index)]!,
  );

  return result;
}

/**
 * Render a Markdown string to styled terminal output.
 *
 * Block-level processing:
 *   - Splits input into blocks separated by blank lines
 *   - Detects headings, horizontal rules, blockquotes, lists, and paragraphs
 *   - Applies inline formatting within each block
 */
export function renderMarkdown(markdown: string): string {
  const lines = markdown.split("\n");
  const blocks = splitIntoBlocks(lines);
  const rendered = blocks.map(renderBlock);
  return rendered.join("\n\n");
}

// --- Block-level types ---

interface ParagraphBlock {
  type: "paragraph";
  lines: string[];
}

interface HeadingBlock {
  type: "heading";
  level: number;
  content: string;
}

interface HorizontalRuleBlock {
  type: "hr";
}

interface BlockquoteBlock {
  type: "blockquote";
  lines: string[];
}

interface UnorderedListBlock {
  type: "ul";
  items: string[];
}

interface OrderedListBlock {
  type: "ol";
  items: string[];
  start: number;
}

type Block =
  | ParagraphBlock
  | HeadingBlock
  | HorizontalRuleBlock
  | BlockquoteBlock
  | UnorderedListBlock
  | OrderedListBlock;

// --- Block detection patterns ---

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const HR_RE = /^(?:---+|\*\*\*+|___+)\s*$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const UL_RE = /^[-*+]\s+(.+)$/;
const OL_RE = /^(\d+)[.)]\s+(.+)$/;

/**
 * Split lines into logical blocks separated by blank lines.
 * Consecutive lines of the same block type are grouped together.
 */
function splitIntoBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    // Skip blank lines
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1]!.length,
        content: headingMatch[2]!,
      });
      i++;
      continue;
    }

    // Horizontal rule
    if (HR_RE.test(line)) {
      blocks.push({ type: "hr" });
      i++;
      continue;
    }

    // Blockquote (consecutive > lines)
    if (BLOCKQUOTE_RE.test(line)) {
      const bqLines: string[] = [];
      while (i < lines.length) {
        const bqMatch = lines[i]!.match(BLOCKQUOTE_RE);
        if (bqMatch) {
          bqLines.push(bqMatch[1]!);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      continue;
    }

    // Unordered list (consecutive - / * / + lines)
    if (UL_RE.test(line)) {
      const items: string[] = [];
      while (i < lines.length) {
        const ulMatch = lines[i]!.match(UL_RE);
        if (ulMatch) {
          items.push(ulMatch[1]!);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "ul", items });
      continue;
    }

    // Ordered list (consecutive numbered lines)
    const olMatch = line.match(OL_RE);
    if (olMatch) {
      const start = Number(olMatch[1]);
      const items: string[] = [];
      while (i < lines.length) {
        const match = lines[i]!.match(OL_RE);
        if (match) {
          items.push(match[2]!);
          i++;
        } else {
          break;
        }
      }
      blocks.push({ type: "ol", items, start });
      continue;
    }

    // Paragraph: collect consecutive non-blank, non-block-start lines
    const paraLines: string[] = [];
    while (i < lines.length) {
      const l = lines[i]!;
      if (
        l.trim() === "" ||
        HEADING_RE.test(l) ||
        HR_RE.test(l) ||
        BLOCKQUOTE_RE.test(l) ||
        UL_RE.test(l) ||
        OL_RE.test(l)
      ) {
        break;
      }
      paraLines.push(l);
      i++;
    }
    if (paraLines.length > 0) {
      blocks.push({ type: "paragraph", lines: paraLines });
    }
  }

  return blocks;
}

/**
 * Render a single block to styled terminal output.
 */
function renderBlock(block: Block): string {
  switch (block.type) {
    case "heading": {
      return styles.bold(renderInline(block.content));
    }

    case "hr": {
      return styles.dim("─".repeat(40));
    }

    case "blockquote": {
      const prefix = styles.dim("│ ");
      return block.lines.map((line) => `${prefix}${renderInline(line)}`).join("\n");
    }

    case "ul": {
      return block.items.map((item) => `  ${styles.dim("•")} ${renderInline(item)}`).join("\n");
    }

    case "ol": {
      const maxNum = block.start + block.items.length - 1;
      const width = String(maxNum).length;
      return block.items
        .map((item, i) => {
          const num = String(block.start + i).padStart(width, " ");
          return `  ${styles.dim(`${num}.`)} ${renderInline(item)}`;
        })
        .join("\n");
    }

    case "paragraph": {
      // Join consecutive lines with a space (soft line break → reflow)
      const text = block.lines.join(" ");
      return renderInline(text);
    }
  }
}
