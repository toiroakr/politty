---
"politty": patch
---

Add `politty/skill` module for managing SKILL.md-based agent skills

- `withSkillCommand(cli, { sourceDir, package })` wraps a command with `skills sync | add | remove | list` subcommands
- Frontmatter is validated against the Agent Skills specification (https://agentskills.io/specification): `name` is lowercase-hyphenated, `description` <=1024 chars, `metadata` is a string->string map, and `license`/`compatibility`/`allowed-tools` are accepted. Unknown top-level keys round-trip via `.passthrough()`
- Installer writes atomically (staging dir + `rename`) into `.agents/skills/<name>/` and symlinks from `.claude/skills/`. Relative symlinks are computed from the realpath of the agent dir so they survive `.claude/skills` itself being a symlink
- Install stamps the SKILL.md with `metadata.politty-cli = "{package}:{cliName}"`. `remove` and `sync` refuse to delete skills that don't carry this CLI's stamp, so two tools managing skills in the same project can't clobber each other
- `sync` also removes orphans — skills the CLI previously installed but no longer bundles
- Scanner returns `{ skills, errors }`; invalid SKILL.md files surface as warnings instead of being silently skipped
- `withSkillCommand` throws if the host command already defines a `skills` subcommand
