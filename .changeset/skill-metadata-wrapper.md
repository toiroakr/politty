---
"politty": patch
---

Add `politty/skill` module for managing SKILL.md-based agent skills

- `withSkillCommand()` wrapper adds `skills sync`, `skills add`, `skills remove`, `skills list` subcommands
- Wraps vercel-labs/skills: provides local path resolution for install, skill filtering for remove
- SKILL.md frontmatter parsing with `package` field for provenance tracking
- `sync` command removes and reinstalls all skills with `--exclude` support
