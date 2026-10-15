---
"@politty/zod": patch
"@politty/valibot": patch
"@politty/zod-mini": patch
"politty": patch
---

Fix argument parsing and dynamic completion for discriminated unions nested inside ordinary unions. Retain compatible sibling branches and preserve named/positional argument roles and aliases when combining completion layouts.

Use shared discriminator selection when prompting for missing arguments.
