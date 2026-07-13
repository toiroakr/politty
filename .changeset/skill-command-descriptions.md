---
"politty": patch
---

Add `SkillCommandOptions.descriptions` to override the description text of the `skills` command and each of its built-in subcommands (`sync`/`add`/`remove`/`list`), letting a host CLI brand the skills command without re-wrapping the command tree by hand. Keys refer to the subcommand's canonical role, independent of any `commandMap` rename — `descriptions.add` still applies after `commandMap.add` renames the subcommand to something else. Omitting `descriptions` (or any of its keys) preserves politty's existing default text exactly.
