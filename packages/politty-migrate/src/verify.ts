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

/** Strip every politty marker line and normalize blank-line runs. */
export function stripMarkers(content: string): string {
  const kept = content.split("\n").filter((line) => !ANY_POLITTY_MARKER.test(line));
  return kept
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+$/, "")
    .replace(/^\s+/, "");
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

  // Produce a minimal line-level diff of the non-marker content.
  const drift = lineDiff(oldStripped, newStripped);
  return { ok: false, drift };
}

/** A compact line diff (old vs new) restricted to differing lines. */
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
