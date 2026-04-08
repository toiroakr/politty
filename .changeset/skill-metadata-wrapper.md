---
"politty": patch
---

Add `politty/skill` module for managing SKILL.md-based agent skills

- `withSkillCommand()` wrapper adds `skills sync`, `skills add`, `skills remove`, `skills list` subcommands
- File-based install/uninstall: copies to `.agents/skills/` with symlinks for agent-specific directories
- SKILL.md frontmatter parsing with `package` field for provenance tracking
- `sync` command removes and reinstalls all skills with `--exclude` support
