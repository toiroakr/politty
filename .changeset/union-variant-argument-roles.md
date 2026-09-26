---
"@politty/valibot": minor
"@politty/zod": minor
"@politty/zod-mini": minor
"politty": minor
---

Read and show union arguments with the definition of the variant that applies. When variants of a discriminated union or union define the same argument differently (a positional in one, an option or a named positional in another), argv is now read with the variant the discriminator selects, or for a union with the first option whose definitions fit the tokens, instead of the first variant's definition. `--target` is accepted only by variants that define it as an option, and a positional token is no longer assigned to an argument the selected variant defines as an option. Help, `--help-json`, and generated docs list such an argument under each variant with that variant's role; shell completion offers `--target` when any variant accepts it, and dynamic completion follows the selected variant.
