# politty-migrate

One-shot migration CLI that converts a [politty](https://github.com/toiroakr/politty) project from the **old marker-based docs** system (nine per-command HTML-comment markers + static `rootInfo`/`FileConfig.render`) to the **new markerless `md`-template API** (a single command-marker pair per command + code-side `layout` templates).

It depends only on `typescript` (used for AST-aware config rewriting) and ships separately so the core `politty` package stays lean.

## Usage

```bash
# preview without writing (bare invocation defaults to --dry-run)
npx politty-migrate --dry-run

# migrate the current directory
npx politty-migrate .

# migrate explicit config files
npx politty-migrate --file path/to/foo.test.ts --file path/to/bar.test.ts

# the migration can also be named explicitly (currently the only one):
npx politty-migrate doc-markers .
```

The first positional argument selects the migration (`doc-markers` — the
default and currently the only one); anything else is treated as the target
directory. Future codemods will be added as new migration names.

After running, finish any `// TODO(politty-migrate: <category>)` anchors using the generated `politty-migrate.todo.md` playbook, then regenerate the Markdown:

```bash
POLITTY_DOCS_UPDATE=true pnpm test
```

## What it does

- Rewrites nine per-command section markers into one `<!-- politty:command:<path>:start --> … :end -->` pair.
- Lifts free text that lived between markers into `layout` / per-command override templates.
- Folds `rootInfo`, `FileConfig.title` / `description` / `render` and the global-options / index / root-header / root-footer markers into a `rootDoc.layout` using `md.globalOptions` / `md.index` / `md.commands()`.
- For configs it cannot rewrite statically (shared-base spreads, variable/computed values), it makes best-effort edits and inserts `// TODO(politty-migrate: <category>)` anchors plus a playbook describing how to finish each category (`spread-config`, `variable-ref`, `dynamic-key`, `layout-review`).
- Verifies that the only differences in regenerated docs are marker removals/transformations; anything else is reported as a `layout-review` follow-up.
