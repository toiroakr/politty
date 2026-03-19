---
"politty": patch
---

Add `politty/skill` module for managing SKILL.md-based agent skills

- `withSkillCommand()` wrapper adds `skill sync` and `skill list` subcommands
- SKILL.md frontmatter parsing with `package` field for provenance tracking
- Skill sync detects additions, updates, and removals by package
- Follows vercel-labs/skills SKILL.md format conventions
- Replaces the previous skill.json-based design
