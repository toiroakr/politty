---
"@politty/loculus": patch
"@politty/zod": patch
"@politty/valibot": patch
"@politty/zod-mini": patch
"politty": patch
---

Add the loculus adapter with typed command definitions, metadata, positional and repeated arguments, defaults, environment fallbacks, discriminated variants, shell completion, docs, prompts, agent helpers and the politty CLI.

Keep CLI unknown-flag handling independent of branch order when composite schemas mix object policies.

Require published Loculus 0.2.x, compatible with optional build-time optimization through @loculus/rolldown 0.2.x.

Support Loculus 0.2.2 boolean and numeric literals in help, completion and discriminated command execution.

Support Loculus 0.2.3 multi-value literals, including mixed typed discriminator choices.

Normalize numeric discriminator spellings before selecting parser and completion layouts, reject ambiguous CLI discriminator spellings, and normalize typed discriminators independently in union, xor and intersection operands.

Select nested discriminated-union argument layouts before checking whether an outer union candidate accepts the command line, across all adapters.

Use normalized discriminator selection for interactive prompts and select nested union discriminator layouts for dynamic completion.
