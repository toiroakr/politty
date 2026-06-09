---
"politty": minor
---

Rewrite the docs generation system around a single command-marker pair and a code-side `md` layout template.

Breaking changes to the docs config API:

- The 9 per-section markers (`:heading:`, `:usage:`, `:options:`, …) are replaced by a single `<!-- politty:command:<path>:start --> … <!-- politty:command:<path>:end -->` pair wrapping each command block. `rootDoc`/layout output is otherwise markerless (the `<a id="global-options"></a>` anchor is preserved).
- Removed: doctor mode (`POLITTY_DOCS_DOCTOR`), `GenerateDocConfig.rootInfo`/`RootCommandInfo`, `FileConfig.title`/`description`/`render`, the global-options/index/root-header/root-footer markers, and the per-section custom `render*` callbacks on `format`.
- Added: `FileConfig.layout` and `RootDocConfig.layout` (compose markerless markdown via the `md` tag), and `FileConfig.commands` accepts a `CommandMap` (`Record<string, true | ((md) => string)>`) or a `string[]`. Every `FileMapping` value is a `FileConfig` (`Record<string, FileConfig>`) — there is no array-sugar or bare-`CommandMap` value form, so the value shape is unambiguous and a file config with neither `commands` nor `layout` throws.
- Free text now lives in a `layout` instead of static markers; the global-options table and command index are exposed as `md.globalOptions` / `md.index` on the root document layout.
- `md.sections(spec)` composes the default command sections with declarative edits (`replace` / `remove` / `insertBefore` / `insertAfter`); `replace` also accepts an updater `(current) => string` to derive a section from its default render.
- Added `politty/docs/vitest` with `createDocSuite(base, options?)`: a Vitest helper that wires the `initDocFile` lifecycle (update-mode gating + real fs under a mock) and returns `match(overrides)` bound to a shared base config.

Existing docs that still use the old 9-marker format must be regenerated (`POLITTY_DOCS_UPDATE=true`); in `targetCommands` partial mode a command without a single command marker is a hard error instructing a full regeneration.

A separate `politty-migrate` CLI (`npx politty-migrate`) is added to automate the upgrade: it rewrites old marker-based doc configs to the new API, lifts free text into `layout` templates, and leaves `// TODO(politty-migrate: …)` anchors with a playbook for anything it cannot convert statically.
