---
"politty": patch
---

Fix subcommand resolution (`resolveSubcommand`, `resolveSubcommandWithAlias`, and the shell-completion context parser) incorrectly matching prototype-inherited property names such as `__proto__` or `constructor` as if they were registered subcommands. This follows up on the same class of bug fixed in `runMain`'s internal-subcommand bypass, applying the `Object.hasOwn` guard to the remaining lookups that read through `Object.prototype`.
