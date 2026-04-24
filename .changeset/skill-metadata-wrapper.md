---
"politty": patch
---

Add `politty/skill` module for managing SKILL.md-based agent skills

- `withSkillCommand(cli, { sourceDir, package })` wraps a command with `skills sync | add | remove | list` subcommands
- Frontmatter is validated against the Agent Skills specification (https://agentskills.io/specification): `name` is lowercase-hyphenated, `description` <=1024 chars, `metadata` is a string->string map, and `license`/`compatibility`/`allowed-tools` are accepted. Unknown top-level keys round-trip via `.passthrough()`
- Installer is symlink-only: `.agents/skills/<name>` is a symlink to the source (typically `node_modules/<pkg>/skills/<name>`), and agent-specific directories (`.claude/skills/<name>`) symlink to that canonical path so one `sync` replaces both hops at once. Source updates propagate live — no staging, no copy, no re-stamping. If `symlinkSync` fails, install errors out rather than falling back to a copy
- Source SKILL.md must pre-declare `metadata["politty-cli"] = "{package}:{cliName}"`; `skills add` / `skills sync` refuse to install a skill whose authored stamp does not match the expected `{package}:{cliName}`, and `remove` / `sync` refuse to delete skills owned by another tool. The installer never writes to SKILL.md — the stamp is authored at package time, not rewritten at install time
- `sync` also removes orphans — skills the CLI previously installed but no longer bundles
- Scanner returns `{ skills, errors }`; invalid SKILL.md files surface as warnings instead of being silently skipped. Symlinked skill dirs and symlinked SKILL.md files are accepted (npm packages already execute arbitrary JS on install, so refusing symlinks here would not raise the trust boundary)
- `withSkillCommand` throws if the host command already defines a `skills` subcommand
