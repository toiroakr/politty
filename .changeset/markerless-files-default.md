---
"politty": minor
---

Make `files`-mode documentation fully generated (marker-free) by default and resolve template links by specificity.

- **Fully generated `files` output by default (breaking).** `files`-mode generation no longer emits `<!-- politty:...:start/end -->` markers; each file is regenerated as a whole. With `targetCommands`, only files containing a target command are processed, but each is rebuilt in full. Set the new `customizable: true` option on `GenerateDocConfig` when you want to hand-edit the output and have politty preserve your edits via markers (in-place section updates). When `customizable` is set, a command whose generated output gains a section the file lacks is reported as a non-fatal warning (run with `POLITTY_DOCS_DOCTOR=true POLITTY_DOCS_UPDATE=true` to insert it, or leave it removed to opt the section out). `path`/`rootDoc` output still uses markers; `templates` remain marker-free.
- **Specificity-based link resolution.** Cross-output links now point at the output that renders a command most specifically — a dedicated per-command page (`{{politty:command:config}}`) wins over a full-tree page (`{{politty:command}}`) for that command and its descendants, regardless of registration order.
- Adds a `markerless` option to `DefaultRendererOptions`.
