---
"politty": minor
---

Positional tokens not consumed by the schema are now surfaced rather than silently ignored.

For commands with subcommands, any unconsumed bare token is treated as an unknown subcommand attempt and exits with code 1 (with a did-you-mean suggestion when a similar name exists).

For commands without subcommands, behaviour follows the schema's `unknownKeysMode`:

- `strict` (`z.strictObject` / `.strict()`): exits with code 1
- `strip` / default (`z.object`): emits a warning and continues
- `passthrough` (`z.looseObject` / `.passthrough()`): silently ignores (no change)
