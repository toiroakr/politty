---
"politty": patch
---

Address Copilot review feedback on `politty/skill`

- `scanSourceDir` now wraps the source directory's `statSync` in try/catch instead of guarding with `existsSync`. Permission/IO errors (EACCES/EPERM) on the source directory are surfaced as `read-failed` ScanErrors with the original error message, where previously they were silently misclassified as `missing-source`.
- `assertSafeName` in the installer now also rejects names longer than 64 characters, matching the frontmatter schema's documented 1..64 length constraint. The check stays a deliberately independent (defense-in-depth) duplicate of the schema rather than a shared import.
- `skills list --json` no longer interleaves scan-error summary lines into stdout. The machine-readable JSON payload stays the only thing on stdout in `--json` mode; per-error stderr warnings still fire so operators can see what was skipped. Previously a malformed source SKILL.md could corrupt the JSON output.
- `listStatus` now reserves `missing` for dangling canonical symlinks (the only state `removeOwnedSkill`'s cleanup path can actually clean up). A real directory at `.agents/skills/<name>` without a readable SKILL.md is now reported as `unstamped`, which routes it through the no-clobber guard instead of incorrectly promising the slot can be reaped.
- `installSkill` now refuses up-front when `mode: "copy"` is requested with a source path that overlaps the install root (source equals, contains, or is inside `.agents/skills/<name>`). Without the guard the copy walk created the destination inside the source and then recursed into it until the path/disk limit was hit; the existing cyclic-symlink detector did not catch this because no symlink was involved.
- Renamed `playground/26-skill-management` to `playground/30-skill-management` so the playground keeps its established unique sequential numbering (`main` already shipped `26-command-alias`).
  </content>
  </invoke>
