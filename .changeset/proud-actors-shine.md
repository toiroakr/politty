---
"politty": patch
---

Fix the internal-subcommand bypass in `runMain` incorrectly matching prototype-inherited property names such as `__proto__`, `__defineGetter__`, or `__lookupGetter__`. Previously, invoking a CLI with one of these as the first positional (e.g. `mycli __proto__`) would silently skip the user-provided `setup`/`cleanup`/`prompt` hooks even though no such subcommand was ever registered, because the lookup read through `Object.prototype` instead of checking for an own property.
