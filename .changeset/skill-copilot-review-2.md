---
"politty": patch
---

Address Copilot review feedback on `politty/skill`

- `scanSourceDir` now wraps the source directory's `statSync` in try/catch instead of guarding with `existsSync`. Permission/IO errors (EACCES/EPERM) on the source directory are surfaced as `read-failed` ScanErrors with the original error message, where previously they were silently misclassified as `missing-source`.
- `assertSafeName` in the installer now also rejects names longer than 64 characters, matching the frontmatter schema's documented 1..64 length constraint. The check stays a deliberately independent (defense-in-depth) duplicate of the schema rather than a shared import.
- `skills list --json` no longer interleaves scan-error summary lines into stdout. The machine-readable JSON payload stays the only thing on stdout in `--json` mode; per-error stderr warnings still fire so operators can see what was skipped. Previously a malformed source SKILL.md could corrupt the JSON output.
- `listStatus` now reserves `missing` for dangling canonical symlinks (the only state `removeOwnedSkill`'s cleanup path can actually clean up). A real directory at `.agents/skills/<name>` without a readable SKILL.md is now reported as `unstamped`, which routes it through the no-clobber guard instead of incorrectly promising the slot can be reaped.
- `installSkill` now refuses up-front when the source path overlaps **any** install destination — the canonical `.agents/skills/<name>` slot or any `SYMLINK_TARGETS` agent slot (e.g. `.claude/skills/<name>`) — in both `mode: "copy"` and `mode: "symlink"`. Previously only copy-mode overlap with the canonical slot was checked: a source sitting at an agent slot survived the canonical check and then got rm-rf'd by `populateAgentDirs`'s own `clearInstallSlot` once the stamp matched, taking the source data with it (and in symlink mode creating a canonical↔agent symlink loop). The copy-mode case where the destination ended up inside the source — recursing until the path/disk limit was hit because the cyclic-symlink detector does not catch it (no symlink involved) — is covered by the same guard.
- Renamed `playground/26-skill-management` to `playground/30-skill-management` so the playground keeps its established unique sequential numbering (`main` already shipped `26-command-alias`).
