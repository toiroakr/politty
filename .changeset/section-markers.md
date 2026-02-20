---
"politty": minor
---

Replace command-level markers with section-level markers

Markers have changed from `<!-- politty:command:<path>:start/end -->` to per-section markers like `<!-- politty:heading:<scope>:start/end -->`, `<!-- politty:description:<scope>:start/end -->`, etc.

Index markers now include a scope parameter: `<!-- politty:index:<scope>:start/end -->`.

This enables users to selectively customize individual sections (heading, description, usage, arguments, options, subcommands, examples, notes) by removing their markers, while keeping other sections auto-generated.
