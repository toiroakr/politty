/**
 * Parser for OLD-format generated markdown documents.
 *
 * The OLD docs system wrapped each command in NINE per-section marker pairs
 * and used file-level markers for global options, the command index, and the
 * root header/footer:
 *
 *   <!-- politty:command:<scope>:<type>:start --> ... :end -->   (type in
 *       heading|description|usage|arguments|options|global-options-link|
 *       subcommands|examples|notes)
 *   <!-- politty:global-options:start --> ... :end -->
 *   <!-- politty:index:<scope>:start --> ... :end -->
 *   <!-- politty:root-header:start --> ... :end -->
 *   <!-- politty:root-footer:start --> ... :end -->
 *
 * This module decomposes such a file into:
 *   - per-command regions (the 9 section blocks, in order, plus any free text
 *     interleaved between them),
 *   - file-level elements (global-options table, index, root header/footer),
 *   - free text that lives BETWEEN / AROUND command regions (prose the author
 *     added by hand outside any marker).
 *
 * It performs no rendering; it is a pure structural decomposition so the
 * config generator can decide, per command, whether a region is "pure
 * default" (=> emit `true`) or carries customization (=> emit a `(md)=>...`
 * override template).
 */

/** OLD per-section types, in render order. */
export const OLD_SECTION_TYPES = [
  "heading",
  "description",
  "usage",
  "arguments",
  "options",
  "global-options-link",
  "subcommands",
  "examples",
  "notes",
] as const;

export type OldSectionType = (typeof OLD_SECTION_TYPES)[number];

/** A single OLD section marker region within a command. */
export interface OldSection {
  type: OldSectionType;
  /** Content strictly between the start and end markers (trimmed of the blank
   * lines the renderer pads with). */
  content: string;
  /** Char offset of the section's start marker (for positional threading). */
  position: number;
}

/**
 * A chunk of free text that appeared BETWEEN the section markers of a single
 * command (an author edited inside the command block). `position` is the char
 * offset where the chunk started so gen-config can thread it back between the
 * correct `${md.*}` sections instead of appending it.
 */
export interface InterSectionChunk {
  position: number;
  text: string;
}

/** A command decomposed from OLD markers. */
export interface OldCommandRegion {
  /** Command path / scope (the `<scope>` slot; "" for root). */
  scope: string;
  /** Sections present, in document order. */
  sections: OldSection[];
  /** Free-text chunks that appeared between this command's section markers,
   * in document order, each tagged with its char offset for positional
   * threading. */
  interSectionChunks: InterSectionChunk[];
  /**
   * Free text that appeared between the section markers of this command,
   * joined with "\n\n". Convenience accessor derived from `interSectionChunks`;
   * kept for callers that only need the aggregate (e.g. isPureDefault).
   */
  interSectionText: string;
  /** Character offset of the first start marker (for ordering). */
  start: number;
  /** Character offset just past the last end marker. */
  end: number;
}

/** File-level (non-command) elements parsed out of the document. */
export interface OldFileElements {
  /** Markdown of the global-options block (without the markers). */
  globalOptions?: string;
  /** Markdown of the command index block (without the markers). */
  index?: string;
  /** Markdown of the root header block. */
  rootHeader?: string;
  /** Markdown of the root footer block. */
  rootFooter?: string;
  /** Char offset of the global-options start marker (for positional layout). */
  globalOptionsPosition?: number;
  /** Char offset of the index start marker. */
  indexPosition?: number;
  /** Char offset of the root-header start marker. */
  rootHeaderPosition?: number;
  /** Char offset of the root-footer start marker. */
  rootFooterPosition?: number;
}

/** Result of parsing an OLD document. */
export interface ParsedOldDoc {
  commands: OldCommandRegion[];
  file: OldFileElements;
  /**
   * Free text outside every marker, in document order, as labeled chunks. The
   * `position` is the char offset where the chunk started, used by gen-config
   * to thread free text into the layout in the right place.
   */
  freeText: Array<{ position: number; text: string }>;
  /** Whether this file looks like an OLD-format file at all. */
  isOldFormat: boolean;
}

const MARKER_RE = /<!--\s*politty:([^>]*?)\s*-->/g;

interface RawMarker {
  /** The inner string, e.g. "command:build:usage:start". */
  body: string;
  /** Offset of the start of the `<!--`. */
  start: number;
  /** Offset just past the `-->`. */
  end: number;
}

function scanMarkers(content: string): RawMarker[] {
  const markers: RawMarker[] = [];
  MARKER_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MARKER_RE.exec(content)) !== null) {
    markers.push({ body: m[1]!.trim(), start: m.index, end: m.index + m[0].length });
  }
  return markers;
}

/** Trim the symmetric blank-line padding the OLD renderer inserted. */
function trimBlock(s: string): string {
  return s
    .replace(/^\s*\n/, "")
    .replace(/\n\s*$/, "")
    .trim();
}

/**
 * Parse an OLD-format markdown string.
 */
export function parseOldDoc(content: string): ParsedOldDoc {
  const markers = scanMarkers(content);
  const result: ParsedOldDoc = {
    commands: [],
    file: {},
    freeText: [],
    isOldFormat: false,
  };

  if (markers.length === 0) {
    return result;
  }

  // Index command regions by scope, preserving order of first appearance.
  const commandByScope = new Map<string, OldCommandRegion>();
  const scopeOrder: string[] = [];

  // Track the ranges consumed by markers + their content, so we can recover
  // free text in the gaps.
  const consumed: Array<{ start: number; end: number }> = [];

  // Pair up start/end markers. We walk linearly and match the nearest
  // following `:end` with the same key.
  for (let i = 0; i < markers.length; i++) {
    const marker = markers[i]!;
    const parts = marker.body.split(":");
    // parts[0] is "command" | "global-options" | "index" | "root-header" | "root-footer"
    const kind = parts[0];

    if (kind === "command" && parts[parts.length - 1] === "start") {
      // command:<scope...>:<type>:start  — scope may itself be empty or contain
      // segments; the second-to-last is the section type.
      const type = parts[parts.length - 2] as OldSectionType;
      const scope = parts.slice(1, parts.length - 2).join(":");
      const endMarker = findEnd(markers, i, marker.body.replace(/:start$/, ":end"));
      if (!endMarker) continue;
      const inner = content.slice(marker.end, endMarker.start);
      result.isOldFormat = true;
      let region = commandByScope.get(scope);
      if (!region) {
        region = {
          scope,
          sections: [],
          interSectionChunks: [],
          interSectionText: "",
          start: marker.start,
          end: endMarker.end,
        };
        commandByScope.set(scope, region);
        scopeOrder.push(scope);
      }
      region.sections.push({ type, content: trimBlock(inner), position: marker.start });
      region.end = Math.max(region.end, endMarker.end);
      region.start = Math.min(region.start, marker.start);
      consumed.push({ start: marker.start, end: endMarker.end });
    } else if (kind === "global-options" && parts[1] === "start") {
      const endMarker = findEnd(markers, i, "global-options:end");
      if (!endMarker) continue;
      result.isOldFormat = true;
      result.file.globalOptions = trimBlock(content.slice(marker.end, endMarker.start));
      result.file.globalOptionsPosition = marker.start;
      consumed.push({ start: marker.start, end: endMarker.end });
    } else if (kind === "index" && parts[parts.length - 1] === "start") {
      const endKey = marker.body.replace(/:start$/, ":end");
      const endMarker = findEnd(markers, i, endKey);
      if (!endMarker) continue;
      result.isOldFormat = true;
      result.file.index = trimBlock(content.slice(marker.end, endMarker.start));
      result.file.indexPosition = marker.start;
      consumed.push({ start: marker.start, end: endMarker.end });
    } else if (kind === "root-header" && parts[1] === "start") {
      const endMarker = findEnd(markers, i, "root-header:end");
      if (!endMarker) continue;
      result.isOldFormat = true;
      result.file.rootHeader = trimBlock(content.slice(marker.end, endMarker.start));
      result.file.rootHeaderPosition = marker.start;
      consumed.push({ start: marker.start, end: endMarker.end });
    } else if (kind === "root-footer" && parts[1] === "start") {
      const endMarker = findEnd(markers, i, "root-footer:end");
      if (!endMarker) continue;
      result.isOldFormat = true;
      result.file.rootFooter = trimBlock(content.slice(marker.end, endMarker.start));
      result.file.rootFooterPosition = marker.start;
      consumed.push({ start: marker.start, end: endMarker.end });
    }
  }

  result.commands = scopeOrder.map((s) => commandByScope.get(s)!);

  /**
   * Find a command region whose section markers strictly enclose `pos`, i.e.
   * the free text sits BETWEEN two of that command's own sections (after the
   * first start marker and before the last end marker). Such text is
   * inter-section prose that belongs to the command, not file-level free text.
   */
  const enclosingCommand = (pos: number): OldCommandRegion | undefined =>
    result.commands.find((c) => pos > c.start && pos < c.end);

  // Recover free text in the gaps between consumed ranges.
  consumed.sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const range of consumed) {
    if (range.start > cursor) {
      const gap = content.slice(cursor, range.start);
      const text = gap.trim();
      if (text) {
        const owner = enclosingCommand(cursor);
        if (owner) {
          owner.interSectionChunks.push({ position: cursor, text });
        } else {
          result.freeText.push({ position: cursor, text });
        }
      }
    }
    cursor = Math.max(cursor, range.end);
  }
  if (cursor < content.length) {
    const tail = content.slice(cursor).trim();
    if (tail) {
      result.freeText.push({ position: cursor, text: tail });
    }
  }

  // Derive the aggregate inter-section text for each command.
  for (const region of result.commands) {
    region.interSectionChunks.sort((a, b) => a.position - b.position);
    region.interSectionText = region.interSectionChunks.map((c) => c.text).join("\n\n");
  }

  return result;
}

function findEnd(markers: RawMarker[], from: number, endBody: string): RawMarker | undefined {
  for (let j = from + 1; j < markers.length; j++) {
    if (markers[j]!.body === endBody) {
      return markers[j];
    }
  }
  return undefined;
}
