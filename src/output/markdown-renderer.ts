import { styles } from "./logger.js";

/**
 * Lightweight Markdown-to-terminal renderer.
 *
 * Supports a subset of Markdown tailored for CLI help notes:
 * - Inline: bold, italic, inline code, links
 * - Block: paragraphs, unordered/ordered lists, blockquotes, headings,
 *          horizontal rules, fenced code blocks
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
    // eslint-disable-next-line no-control-regex -- null bytes are intentionally used as code span delimiters
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
 *   - Detects headings, horizontal rules, blockquotes, lists, code blocks, and paragraphs
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

type AlertType = "NOTE" | "TIP" | "IMPORTANT" | "WARNING" | "CAUTION";

interface AlertBlock {
  type: "alert";
  alertType: AlertType;
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

interface CodeBlock {
  type: "code";
  lang: string;
  lines: string[];
}

interface TableBlock {
  type: "table";
  headers: string[];
  alignments: ("left" | "center" | "right")[];
  rows: string[][];
}

type Block =
  | ParagraphBlock
  | HeadingBlock
  | HorizontalRuleBlock
  | BlockquoteBlock
  | AlertBlock
  | UnorderedListBlock
  | OrderedListBlock
  | CodeBlock
  | TableBlock;

// --- Block detection patterns ---

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const HR_RE = /^(?:---+|\*\*\*+|___+)\s*$/;
const BLOCKQUOTE_RE = /^>\s?(.*)$/;
const UL_RE = /^-\s+(.+)$/;
const OL_RE = /^(\d+)[.)]\s+(.+)$/;
const FENCE_OPEN_RE = /^(`{3,}|~{3,})(\S*)\s*$/;
const ALERT_RE = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/;
const TABLE_ROW_RE = /^\|(.+)\|$/;
const TABLE_SEP_RE = /^\|(\s*:?-+:?\s*\|)+$/;

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

    // Fenced code block
    const fenceMatch = line.match(FENCE_OPEN_RE);
    if (fenceMatch) {
      const fence = fenceMatch[1]!;
      const lang = fenceMatch[2] ?? "";
      const codeLines: string[] = [];
      i++; // skip opening fence
      while (i < lines.length) {
        // Closing fence: same char, at least same length
        if (
          lines[i]!.startsWith(fence.charAt(0).repeat(fence.length)) &&
          lines[i]!.trim() ===
            fence.charAt(0).repeat(Math.max(fence.length, lines[i]!.trim().length))
        ) {
          i++; // skip closing fence
          break;
        }
        codeLines.push(lines[i]!);
        i++;
      }
      blocks.push({ type: "code", lang, lines: codeLines });
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

    // Blockquote or GitHub alert (consecutive > lines)
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
      // Check if first line is a GitHub alert marker: [!TYPE]
      if (bqLines.length > 0) {
        const alertMatch = bqLines[0]!.match(ALERT_RE);
        if (alertMatch) {
          const contentLines = bqLines.slice(1).filter((l) => l !== "");
          blocks.push({
            type: "alert",
            alertType: alertMatch[1] as AlertType,
            lines: contentLines,
          });
          continue;
        }
      }
      blocks.push({ type: "blockquote", lines: bqLines });
      continue;
    }

    // Unordered list (consecutive - lines only)
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

    // Table: header row | separator row | body rows
    if (TABLE_ROW_RE.test(line) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!)) {
      const headers = parseCells(line);
      const alignments = parseAlignments(lines[i + 1]!);
      i += 2; // skip header + separator
      const rows: string[][] = [];
      while (i < lines.length && TABLE_ROW_RE.test(lines[i]!)) {
        rows.push(parseCells(lines[i]!));
        i++;
      }
      blocks.push({ type: "table", headers, alignments, rows });
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
        OL_RE.test(l) ||
        FENCE_OPEN_RE.test(l) ||
        (TABLE_ROW_RE.test(l) && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]!))
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
 * Parse cells from a table row: `| a | b | c |` → `["a", "b", "c"]`
 */
function parseCells(row: string): string[] {
  return row
    .slice(1, -1)
    .split("|")
    .map((cell) => cell.trim());
}

/**
 * Parse alignment from separator row: `|:---|:---:|---:|` → `["left", "center", "right"]`
 */
function parseAlignments(sepRow: string): ("left" | "center" | "right")[] {
  return sepRow
    .slice(1, -1)
    .split("|")
    .map((cell) => {
      const trimmed = cell.trim();
      if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
      if (trimmed.endsWith(":")) return "right";
      return "left";
    });
}

/**
 * Pad a string to a given width with the specified alignment.
 */
function alignText(text: string, width: number, alignment: "left" | "center" | "right"): string {
  if (alignment === "right") return text.padStart(width);
  if (alignment === "center") {
    const total = width - text.length;
    const left = Math.floor(total / 2);
    return " ".repeat(left) + text + " ".repeat(total - left);
  }
  return text.padEnd(width);
}

/**
 * Style configuration for GitHub-style alert blocks.
 */
const alertStyles: Record<
  AlertType,
  { icon: string; label: string; styleFn: (s: string) => string }
> = {
  NOTE: { icon: "ℹ", label: "Note", styleFn: styles.cyan },
  TIP: { icon: "💡", label: "Tip", styleFn: styles.green },
  IMPORTANT: { icon: "❗", label: "Important", styleFn: styles.magenta },
  WARNING: { icon: "⚠", label: "Warning", styleFn: styles.yellow },
  CAUTION: { icon: "🔴", label: "Caution", styleFn: styles.red },
};

/**
 * Render a single block to styled terminal output.
 */
function renderBlock(block: Block): string {
  switch (block.type) {
    case "heading": {
      // Inspired by marked-terminal: green + bold to distinguish from section headers (bold + underline)
      return styles.green(styles.bold(renderInline(block.content)));
    }

    case "hr": {
      return styles.dim("─".repeat(40));
    }

    case "blockquote": {
      const prefix = styles.dim("│ ");
      return block.lines.map((line) => `${prefix}${renderInline(line)}`).join("\n");
    }

    case "alert": {
      const { icon, label, styleFn } = alertStyles[block.alertType];
      const prefix = styleFn(styles.bold("│")) + " ";
      const header = `${prefix}${styleFn(icon)} ${styleFn(label)}`;
      if (block.lines.length === 0) {
        return header;
      }
      const body = block.lines.map((line) => `${prefix}${renderInline(line)}`).join("\n");
      return `${header}\n${body}`;
    }

    case "ul": {
      return block.items.map((item) => `${styles.dim("•")} ${renderInline(item)}`).join("\n");
    }

    case "ol": {
      const maxNum = block.start + block.items.length - 1;
      const width = String(maxNum).length;
      return block.items
        .map((item, i) => {
          const num = String(block.start + i).padStart(width, " ");
          return `${styles.dim(`${num}.`)} ${renderInline(item)}`;
        })
        .join("\n");
    }

    case "table": {
      const colCount = block.headers.length;
      // Calculate column widths from headers and all rows
      const colWidths = block.headers.map((h, i) => {
        const cellLengths = block.rows.map((row) => (row[i] ?? "").length);
        return Math.max(h.length, ...cellLengths);
      });
      const pipe = styles.dim("│");
      // Border rows
      const topBorder = styles.dim(`┌─${colWidths.map((w) => "─".repeat(w)).join("─┬─")}─┐`);
      const midBorder = styles.dim(`├─${colWidths.map((w) => "─".repeat(w)).join("─┼─")}─┤`);
      const botBorder = styles.dim(`└─${colWidths.map((w) => "─".repeat(w)).join("─┴─")}─┘`);
      // Header row (bold)
      const headerCells = block.headers.map((h, i) =>
        styles.bold(alignText(h, colWidths[i]!, block.alignments[i] ?? "left")),
      );
      const headerRow = `${pipe} ${headerCells.join(` ${pipe} `)} ${pipe}`;
      // Body rows
      const bodyRows = block.rows.map((row) => {
        const cells = Array.from({ length: colCount }, (_, i) =>
          renderInline(alignText(row[i] ?? "", colWidths[i]!, block.alignments[i] ?? "left")),
        );
        return `${pipe} ${cells.join(` ${pipe} `)} ${pipe}`;
      });
      return [topBorder, headerRow, midBorder, ...bodyRows, botBorder].join("\n");
    }

    case "code": {
      // Extra indent for code blocks to distinguish from surrounding text
      return block.lines.map((line) => `  ${styles.yellow(line)}`).join("\n");
    }

    case "paragraph": {
      // Join consecutive lines with a space (soft line break → reflow)
      const text = block.lines.join(" ");
      return renderInline(text);
    }
  }
}
