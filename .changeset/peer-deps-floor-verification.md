---
"politty": patch
"@politty/zod": patch
"@politty/valibot": patch
---

Correct `peerDependencies` lower bounds and verify them in CI.

`peerDependencies` floors had never actually been installed and tested, so Renovate's `rangeStrategy: "bump"` (which is meant for exclusive `dependencies`/`devDependencies` copies, not floors declared for consumers) had silently pushed them past what's really required: `zod` to `^4.4.3` (actually works from `^4.2.1`) and `@inquirer/prompts` to `^8.5.2` (actually works from `^8.3.2`) in `politty` and `@politty/zod`; `@inquirer/prompts` the same way, plus `valibot` to `^1.4.2`, in `@politty/valibot`. Installing the originally-declared `valibot` floor (`^1.0.0`) turned up a real gap instead — `v.multipleOf()`'s bigint overload, which `@politty/valibot`'s adapter type-checks against, isn't present before `1.1.0` — so that floor is corrected upward to `^1.1.0` rather than restored.

`renovate.json` now widens `peerDependencies` instead of bumping them, and CI installs each package's exact declared peer floor and runs the test suite against it, so a future floor drift gets caught before merge instead of silently shipping.
