---
"politty": patch
---

Improve `withSkillCommand`'s type safety and customizability for host CLIs:

- `withSkillCommand`'s return type now reflects the injected `skills` subcommand (`subCommands.skills` is typed as `AnyCommand` and no longer optional), so consumers no longer need an `as AnyCommand` cast to access it.
- `SkillCommandOptions.globalArgs` accepts the same schema passed to `runMain`/`runCommand`'s `globalArgs`. When it already declares a same-named _non-positional boolean_ `verbose`/`json` field, `skills add`/`skills sync`'s `--verbose` and `skills list`'s `--json` are automatically omitted from their own schema, so the host's global flag of the same name takes priority — no manual configuration needed. (A same-named non-boolean field doesn't trigger this; politty itself rejects that combination with `FieldTypeConflictError` at parse time, so such a field must be renamed on one side instead.)
- `SkillFlagOverrides.verbose.alias` renames or disables `skills add`/`skills sync --verbose`'s short alias — a collision independent of `globalArgs`'s field-name auto-detection (e.g. the host's `-v` belongs to an unrelated flag, not one named `verbose`).
- `SkillCommandOptions.commandMap` lets a host CLI rename `skills add`/`skills remove` and control their aliases: `{ add?: string[]; remove?: string[] }`, where the first array element becomes the subcommand's dispatched name and the rest become aliases. Default: `add: ["add", "install"]`, `remove: ["remove", "uninstall"]`. `withSkillCommand` throws if any resulting name or alias collides with `sync`/`list` or with each other, or isn't a safe token (empty string, leading dash, whitespace, etc.).
- `SkillCommandOptions.unknownKeys` (`"strict"` \| `"strip"` \| `"passthrough"`, default `"strip"`) controls unknown-flag handling for `add`/`sync`/`remove`/`list`'s own schemas uniformly — set `"strict"` to match a host CLI that uses `z.strictObject()` throughout. `"passthrough"` matches `z.object().passthrough()`: no warning, but (unlike `"strip"`) the flag's value is kept on the parsed args under its raw CLI name instead of dropped. Never affects values that legitimately arrive via `globalArgs`.
