/**
 * Verify a migration by comparing the OLD markdown against the NEW (freshly
 * regenerated) markdown.
 *
 * SUCCESS criterion: the only differences are MARKER removals / transformations
 * — the 9 per-section markers collapse to a single `politty:command:<path>`
 * pair, and the file-level `global-options` / `index` / `root-header` /
 * `root-footer` markers are removed. Every NON-marker line must be
 * byte-identical. Any other difference is a content drift and is reported as a
 * `layout-review` TODO.
 *
 * This module does NOT run the generator itself (the CLI orchestrates that and
 * the actual `assertDocMatch`/`POLITTY_DOCS_UPDATE` run lives in the host
 * project). It is given the two strings and classifies the diff.
 */

const ANY_POLITTY_MARKER = /^\s*<!--\s*politty:[^>]*-->\s*$/;

/**
 * Strip every politty marker line and normalize blank-line runs.
 *
 * Only marker lines and SURROUNDING BLANK LINES are touched: leading/trailing
 * blank lines are dropped and 3+ newline runs collapse to one blank line (both
 * are artifacts of removing marker lines). Meaningful whitespace — e.g. the
 * indentation of the first content line — is preserved so real content drift
 * is never masked.
 *
 * Line endings are normalized to LF up-front so CRLF (Windows) docs are handled
 * identically: blank-line normalization stays reliable and a pure EOL-only
 * difference between the old and new doc is not reported as content drift.
 */
export function stripMarkers(content: string): string {
  const normalized = content.replace(/\r\n?/g, "\n");
  const kept = normalized.split("\n").filter((line) => !ANY_POLITTY_MARKER.test(line));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/(?:\n[ \t]*)+$/, "")
    .replace(/^(?:[ \t]*\n)+/, "");
}

export interface VerifyResult {
  /** True when the only changes were marker removals/transformations. */
  ok: boolean;
  /** Content-drift hunks (non-marker differences). */
  drift: string[];
}

/**
 * Compare OLD vs NEW markdown, ignoring marker-only differences.
 */
export function verifyMigration(oldMd: string, newMd: string): VerifyResult {
  const oldStripped = stripMarkers(oldMd);
  const newStripped = stripMarkers(newMd);
  if (oldStripped === newStripped) {
    return { ok: true, drift: [] };
  }

  // Produce a naive line-by-line diff of the non-marker content.
  const drift = lineDiff(oldStripped, newStripped);
  return { ok: false, drift };
}

/** Naive line-by-line diff (old vs new) at matching indices. */
function lineDiff(a: string, b: string): string[] {
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const out: string[] = [];
  const max = Math.max(aLines.length, bLines.length);
  for (let i = 0; i < max; i++) {
    const al = aLines[i];
    const bl = bLines[i];
    if (al !== bl) {
      if (al !== undefined) out.push(`- ${al}`);
      if (bl !== undefined) out.push(`+ ${bl}`);
    }
  }
  return out;
}
