---
"politty": patch
---

Add `politty/skill` module for managing SKILL.md-based agent skills

- `withSkillCommand(cli, { sourceDir, package })` wraps a command with `skills sync | add | remove | list` subcommands
- Frontmatter is validated against the Agent Skills specification (https://agentskills.io/specification): `name` is lowercase-hyphenated, `description` <=1024 chars, `metadata` is a string->string map, and `license`/`compatibility`/`allowed-tools` are accepted. Unknown top-level keys round-trip via `.passthrough()`
- Installer populates `.agents/skills/<name>` (canonical) and each agent-specific dir (e.g. `.claude/skills/<name>`) from the source; the materialization is controlled by `mode`: `"symlink"` (default — source updates propagate live; throws with guidance to retry with `"copy"` on filesystems without symlink support, e.g. Windows without Developer Mode) or `"copy"` (recursive copy that works anywhere but requires re-running `sync` to propagate updates). Agent-specific slots route through the canonical slot so one `sync` swaps all hops at once
- Source SKILL.md must pre-declare `metadata["politty-cli"] = "{package}:{cliName}"`; `skills add` / `skills sync` refuse to install a skill whose authored stamp does not match the expected `{package}:{cliName}`, and `remove` / `sync` refuse to delete skills owned by another tool. Copy-mode installs carry the stamp because the source SKILL.md is copied verbatim. The installer never writes to SKILL.md — the stamp is authored at package time, not rewritten at install time
- `sync` also removes orphans — skills the CLI previously installed but no longer bundles
- Scanner returns `{ skills, errors }`; invalid SKILL.md files surface as warnings instead of being silently skipped. Symlinked skill dirs and symlinked SKILL.md files are accepted (npm packages already execute arbitrary JS on install, so refusing symlinks here would not raise the trust boundary)
- `withSkillCommand` throws if the host command already defines a `skills` subcommand
