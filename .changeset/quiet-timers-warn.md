---
"politty": minor
---

Disable default boolean negation unless `negation: true` is set.

Boolean options no longer accept `--no-<name>` or `--no<Name>` by default. Set `negation: true` to enable and advertise the default negation form, set `negation` to a string to use a custom negation name, or leave it unset / set it to `false` to reject default negation.
