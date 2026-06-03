---
"politty": minor
---

Rewrite the docs generation system around a single command-marker pair and a code-side `md` layout template.

Breaking changes to the docs config API:

- The 9 per-section markers (`:heading:`, `:usage:`, `:options:`, …) are replaced by a single `<!-- politty:command:<path>:start --> … <!-- politty:command:<path>:end -->` pair wrapping each command block. `rootDoc`/layout output is otherwise markerless (the `<a id="global-options"></a>` anchor is preserved).
- Removed: doctor mode (`POLITTY_DOCS_DOCTOR`), `GenerateDocConfig.rootInfo`/`RootCommandInfo`, `FileConfig.title`/`description`/`render`, the global-options/index/root-header/root-footer markers, and the per-section custom `render*` callbacks on `format`.
- Added: `FileConfig.layout` and `RootDocConfig.layout` (compose markerless markdown via the `md` tag), and `FileConfig.commands` now accepts a `CommandMap` (`Record<string, true | ((md) => string)>`) in addition to a `string[]`. `FileMapping` values may be a `string[]`, a flat `CommandMap`, or a `FileConfig`.
- Free text now lives in a `layout` instead of static markers; the global-options table and command index are exposed as `md.globalOptions` / `md.index` on the root document layout.

Existing docs that still use the old 9-marker format must be regenerated (`POLITTY_DOCS_UPDATE=true`); in `targetCommands` partial mode a command without a single command marker is a hard error instructing a full regeneration.

A separate `politty-migrate` CLI (`npx politty-migrate`) is added to automate the upgrade: it rewrites old marker-based doc configs to the new API, lifts free text into `layout` templates, and leaves `// TODO(politty-migrate: …)` anchors with a playbook for anything it cannot convert statically.
