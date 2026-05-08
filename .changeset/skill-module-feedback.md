---
"politty": patch
---

Improve `politty/skill` ergonomics based on usage feedback

- `skills sync --exclude` now uses `-x` as its short alias instead of `-e`, sidestepping the common collision with CLI-level global flags. Override or disable per CLI via `flags.exclude.alias` (string to rename, `false` to drop the alias entirely).
- `withSkillCommand` resolves the install root by walking up from `process.cwd()` to the closest `.git/` or `package.json`, falling back to `process.cwd()`. This stops `<sub>/.agents/skills/...` from appearing when the CLI is invoked from a project subdirectory. Override with the new `cwd` option (e.g. the directory of a CLI-specific config file). The programmatic primitives (`installSkill`, `uninstallSkill`, `hasInstalledSkill`, `readInstalledOwnership`) keep their original `process.cwd()` default — find-up only applies inside `withSkillCommand`'s subcommands.
- `withSkillCommand` appends a one-line skills usage hint to the wrapped command's `description` so `--help` advertises the skills subcommand. Pass `descriptionAppend: false` to opt out, or a string to override the hint.
- `skills add` and `skills sync` accept `--verbose` / `-v`, which prints the install path and resolved mode for each installed skill.
- `skills list` now reports a per-skill `status` (`installed`, `not-installed`, `foreign`, `unstamped`, `missing`) in both text and JSON output, surfacing common packaging mistakes (e.g. `politty-cli` typos installed under another stamp) without having to hand-inspect `.agents/skills/<name>`.
- `skills sync`, `skills remove`, and per-skill scan errors now print explicit summary lines on stdout (`No skills installed (all excluded).`, `nothing to remove`, `Skipped N skill(s) due to scan errors`) so an empty result is no longer silent in stdout-only pipelines.
- Documented symlink target convention (relative, realpath-resolved), atomicity (per-call non-transactional, multi-skill fail-fast, idempotent on re-run), and the Windows / no-symlink-filesystem fallback to `mode: "copy"` in `docs/skill-management.md` and the `installSkill` JSDoc.
