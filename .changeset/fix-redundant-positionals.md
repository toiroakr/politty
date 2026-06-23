---
"politty": minor
---

Positional tokens not consumed by the schema are now surfaced rather than silently ignored.

For commands with subcommands, any unconsumed bare token that is not a known subcommand name is treated as an unknown subcommand attempt and exits with code 1 (with a did-you-mean suggestion when a similar name exists). Tokens after `--`, dash-prefixed tokens, and tokens that match a known subcommand name are excluded from this check — they fall through to the `unknownKeysMode` positional handling instead.

For commands without subcommands, behaviour follows the schema's `unknownKeysMode`:

- `strict` (`z.strictObject` / `.strict()`): exits with code 1
- `strip` / default (`z.object`): emits a warning and continues
- `passthrough` (`z.looseObject` / `.passthrough()`): silently ignores (no change)

Schema-less commands (no `args` defined) now correctly capture all tokens — including flag-like ones such as `-x` — as positionals so stray tokens are still detected.
