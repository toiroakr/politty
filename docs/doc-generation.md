# Documentation Generator

A system that generates Markdown documentation from CLI commands defined with `defineCommand` and validates consistency with golden tests.

The document structure lives **in code** as `md` tagged-template functions. Generated files contain a single marker pair per command (used for per-command partial validation); everything else — file headers, global options, the command index, free-form prose — is produced from your templates and is otherwise markerless.

> **Upgrading from the marker-based API?** Earlier versions embedded nine HTML-comment markers per command in the Markdown and wrote prose between them. That model is gone. Run `npx politty-migrate` to convert an existing project automatically (see [Migration](#migration)).

## Quick Start

```typescript
import { describe, it } from "vitest";
import { assertDocMatch } from "politty/docs";
import { command } from "./my-command.js";

describe("my-command", () => {
  it("documentation", async () => {
    await assertDocMatch({
      command,
      files: { "path/to/README.md": { commands: [""] } },
    });
  });
});
```

### Updating Documentation

Tests fail when there are differences. Set the environment variable and run tests to (re)write files:

```bash
POLITTY_DOCS_UPDATE=true pnpm test
```

## API

### `assertDocMatch(config)`

Validates that documentation matches the generated output. Throws when there are differences and `POLITTY_DOCS_UPDATE` is not set.

### `generateDoc(config)`

Generates documentation and returns the result without asserting.

```typescript
const result = await generateDoc({ command, files: { "docs/cli.md": { commands: [""] } } });
console.log(result.success, result.files);
```

### `initDocFile(config, fileSystem?)`

Deletes documentation files at the start of a test run (only when `POLITTY_DOCS_UPDATE=true`) so stale sections from skipped tests don't linger. Call it in `beforeAll`. Pass `realFs` as the second argument when `node:fs` is mocked.

### `createDocSuite(base, options?)` (from `politty/docs/vitest`)

A thin Vitest helper that wires the `initDocFile` lifecycle for you. Call it at the top of a `describe`; it registers a `beforeAll(() => initDocFile(base, fileSystem))` and returns `{ match }`, where `match(overrides)` runs `assertDocMatch({ ...base, ...overrides })`. This removes the three easy-to-forget steps of the manual pattern: calling `initDocFile` in `beforeAll`, passing the real fs under a mock, and gating on update mode.

```typescript
import { createDocSuite } from "politty/docs/vitest";

describe("cli docs", () => {
  const doc = createDocSuite(baseConfig, { fileSystem: realFs });
  it("read", () => doc.match({ targetCommands: ["read"], examples: { read: { mock, cleanup } } }));
  it("write", () => doc.match({ targetCommands: ["write"] }));
});
```

It lives in the `politty/docs/vitest` subpath (not `politty/docs`) so the core API stays test-runner-agnostic; `vitest` is an optional peer dependency.

## The `md` template model

Each documented command is rendered either by the **default renderer** or by a **per-command override** you supply. A file's overall structure is controlled by an optional **layout**. Both overrides and layouts are written with the `md` tagged template, which dedents the literal, trims surrounding blank lines, and collapses blank-line runs (so an empty interpolation never leaves a gap).

### Three layers

| Layer      | What it controls                                               | Shape                                                |
| ---------- | -------------------------------------------------------------- | ---------------------------------------------------- |
| `commands` | Which commands appear, and how each renders                    | `string[]` or `Record<path, true \| (md) => string>` |
| `layout`   | The file's frame (headings, prose) and where command blocks go | `(md) => string` using `md.commands()`               |
| override   | A single command's block                                       | `(md) => string` using `md.usage`, `md.options`, …   |

- `true` (or the array-sugar form) renders a command with the default renderer.
- A function value **overrides** that command: you compose its block from the section getters plus your own prose.
- Free text _between_ two commands belongs to the adjacent command's override (the end of the preceding one, or the start of the next).

### Command override getters

Inside a per-command override, `md` is bound to that command:

| Accessor               | Output                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `md.h(level, text?)`   | Heading at a **relative** level (`1` = the command's base level in the file, `2` = one deeper). `text` defaults to the command name. |
| `md.description`       | Description text (and an Aliases line when present)                                                                                  |
| `md.usage`             | `**Usage**` block                                                                                                                    |
| `md.arguments`         | `**Arguments**` table/list (`""` when none)                                                                                          |
| `md.options`           | `**Options**` table/list (`""` when none)                                                                                            |
| `md.globalOptionsLink` | "See Global Options" link (only when `rootDoc.globalOptions` is set)                                                                 |
| `md.subcommands`       | `**Commands**` table (`""` when none)                                                                                                |
| `md.examples`          | `**Examples**` block (`""` when none)                                                                                                |
| `md.notes`             | `**Notes**` block (`""` when none)                                                                                                   |

```typescript
await assertDocMatch({
  command: cli,
  files: {
    "docs/cli.md": {
      init: true, // default render
      build: true, // default render
      deploy: (md) => md`
        ${md.h(1)}

        ${md.description}

        > ⚠️ Confirm on staging before deploying to production.

        ${md.usage}

        ${md.options}

        ${md.globalOptionsLink}
      `,
    },
  },
});
```

### Editing sections (`md.sections`)

Re-listing every section just to tweak one is tedious. `md.sections(spec)` renders
the command's default sections, applying only the edits you declare — everything
else keeps its default. The result is a string, so use it as the override's
return value (or interpolate it inside `md\`…\``).

```typescript
deploy: (md) =>
  md.sections({
    replace: { options: md`${md.h(2, "Options")}\n\n(custom table)` },
    insertAfter: { usage: "> ⚠️ Confirm on staging before deploying." },
    remove: ["examples"],
  });

// Wrap in md`` only when you need extra surrounding prose:
build: (md) => md`
  ${md.h(1)}

  Intro paragraph.

  ${md.sections({ remove: ["heading"] })}
`;
```

`SectionsSpec`:

| Key            | Type                                                          | Effect                                                     |
| -------------- | ------------------------------------------------------------- | ---------------------------------------------------------- |
| `order`        | `SectionName[]`                                               | Render sections in this exact sequence (omitted ones drop) |
| `replace`      | `Partial<Record<SectionName, string \| (current) => string>>` | Swap a section's content, keeping its position             |
| `remove`       | `SectionName[]`                                               | Drop these sections                                        |
| `insertBefore` | `Partial<Record<SectionName, string \| string[]>>`            | Insert before the named section                            |
| `insertAfter`  | `Partial<Record<SectionName, string \| string[]>>`            | Insert after the named section                             |

`order` is authoritative when given: only the listed sections are emitted, in that sequence (so it both reorders and selects). `replace` / `insertBefore` / `insertAfter` still apply, anchored by name. Example — render the global-options link last:

```typescript
md.sections({
  order: [
    "heading",
    "description",
    "usage",
    "arguments",
    "options",
    "subcommands",
    "examples",
    "notes",
    "globalOptionsLink",
  ],
});
```

A `replace` value can be a function `(current) => string`, where `current` is the
section's default render. Use it to tweak the default instead of rebuilding it:

```typescript
md.sections({
  // add a column to the default options table without re-deriving it
  replace: { options: (current) => current.replace("| Name |", "| Name | Since |") },
});
```

To add prose before/after the whole block, wrap the result in `md\`…\``and write it around the interpolated`${md.sections(...)}`(shown above) — there is no`prepend`/`append`.

- `SectionName` is one of `heading` / `description` / `usage` / `arguments` / `options` / `globalOptionsLink` / `subcommands` / `examples` / `notes`. An unknown name is a type error (and throws at runtime).
- Edits are anchored by section name and applied in render order; all nine anchors always exist, so `insertAfter: { arguments: … }` works even when the command has no arguments. Empty sections are dropped from the output.
- `md.sections()` with no spec equals the default render (the same as `true`).

### Layout getters

Inside a `layout`, `md` exposes:

| Accessor           | Output                                                                           |
| ------------------ | -------------------------------------------------------------------------------- |
| `md.commands()`    | All of this file's command blocks, in order (each wrapped in its command marker) |
| `md.globalOptions` | The global options table (root document only; `""` elsewhere)                    |
| `md.index`         | The command index (root document only; `""` elsewhere)                           |

If a `layout` is omitted, a default layout is used: a title/description header, then (for the root document) global options and the index, then `md.commands()`.

## Configuration

### `GenerateDocConfig`

| Property         | Type                     | Description                                         |
| ---------------- | ------------------------ | --------------------------------------------------- |
| `command`        | `AnyCommand`             | Command to document                                 |
| `files`          | `FileMapping`            | File path → commands/layout mapping                 |
| `path`           | `PathConfig`             | Simpler alternative to `files` (mutually exclusive) |
| `rootDoc`        | `RootDocConfig`          | Root document (global options table + index host)   |
| `globalArgs`     | `ArgsSchema`             | Derives `rootDoc.globalOptions` from a schema       |
| `ignores`        | `string[]`               | Command paths to exclude (with subcommands)         |
| `format`         | `DefaultRendererOptions` | Display options for the default renderer            |
| `formatter`      | `FormatterFunction`      | Formats generated content before comparison         |
| `examples`       | `ExampleConfig`          | Example execution settings per command              |
| `targetCommands` | `string[]`               | Validate/generate only these commands' blocks       |

### `FileMapping`

Each file path maps to a `FileConfig`: a `commands` list (and/or a custom `layout`). `commands` is either an **array** of command paths (default render) or a **`CommandMap`** (`true` for default, a function to override). Array vs. object is the only distinction, and it is unambiguous.

```typescript
const files: FileMapping = {
  // commands array — every listed command (and subcommands) uses the default render.
  "docs/cli.md": { commands: ["", "config"] },

  // commands map — `true` for default, a function to override.
  "docs/users.md": {
    commands: {
      user: true,
      "user create": (md) => md`${md.h(1)}\n\n${md.usage}`,
    },
  },

  // a custom file layout alongside the command map.
  "docs/admin.md": {
    commands: { admin: true },
    layout: (md) => md`# Admin\n\nInternal tools.\n\n${md.commands()}`,
  },
};
```

A `FileConfig` must have `commands` and/or `layout` (an object with neither throws). There are no value-level forms to disambiguate and no reserved-command-name edge case — a command named `commands` or `layout` is just a key inside `commands: { … }`.

`FileConfig.index` (`{ title?, description? }`) sets this file's entry in the root command index (`md.index`). When omitted, the index derives the title/description from the file's first command; set it to keep a curated category label (e.g. `index: { title: "Application Commands", description: "…" }`).

`FileConfig.sections` (a `SectionsSpec`) is the file-level **default renderer**: it is applied to every command in the file that does not have an explicit function override, equivalent to giving each a `(md) => md.sections(spec)` override. Use it to apply a custom section order (or drop a section) across a whole file without repeating it per command:

```typescript
"docs/cli/application.md": {
  commands: ["init", "generate", "deploy"],
  // render globalOptionsLink last for every command in this file
  sections: { order: ["heading", "description", "usage", "arguments", "options", "subcommands", "examples", "notes", "globalOptionsLink"] },
}
```

Precedence per command: an explicit `(md) => …` override in `commands` wins; otherwise `FileConfig.sections` (if set); otherwise the default render.

- **Subcommands are automatically included** (`"config"` pulls in `"config get"`, …).
- **Wildcards**: `*` matches one command segment — `"config *"`, `"* *"`, `"*"`.
- **Cross-file links**: when subcommands live in other files, relative links are generated automatically.

### `rootDoc`

The root document hosts the **global options table** and the **command index**, and enables the per-command `md.globalOptionsLink`.

```typescript
await assertDocMatch({
  command: cli,
  rootDoc: {
    path: "docs/REFERENCE.md",
    globalOptions: commonOptions, // ArgsShape, or { args, options }
    layout: (md) => md`
      # project-cli

      Project management CLI.

      ## Global Options

      ${md.globalOptions}

      ## Command Reference

      ${md.index}
    `,
  },
  files: { "docs/README.md": { commands: ["init", "build", "deploy"] } },
});
```

- `md.globalOptionsLink` in command blocks is empty unless `rootDoc.globalOptions` is set.
- Omit `layout` to get the default root layout (header + global options + index).
- For a single-file setup, point `rootDoc.path` at the same file and call `${md.commands()}` in its layout.

### `path` (shorthand)

A simpler alternative to `files`:

```typescript
// All commands in one file
path: "docs/CLI.md"

// Split: root + specific subtrees in their own files
path: { root: "docs/CLI.md", commands: { build: "docs/build.md" } }
```

### `globalArgs`

When provided, automatically derives `rootDoc.globalOptions` from a runtime schema and renders the global options table + per-command links.

### `format` (display options)

```typescript
format: {
  headingLevel: 2,        // base heading level (default 1)
  optionStyle: "list",    // "table" | "list"
  generateAnchors: true,  // anchor links to subcommands
  includeSubcommandDetails: true,
}
```

Heading levels are adjusted per file: the shallowest command uses `headingLevel`, deeper subcommands increase by depth. Inside an override, `md.h(1)` resolves to that command's adjusted base level.

> Per-section render callbacks (`renderOptions`, `renderFooter`, …) no longer exist. Customize a section by writing a per-command override that composes the section getters with your own markdown.

### `examples`

Executes `examples` defined in `defineCommand` and includes their output. Mocks can be set per command:

```typescript
await assertDocMatch({
  command: cli,
  files: { "docs/cli.md": { commands: ["", "read"] } },
  examples: {
    read: {
      mock: () => {
        /* set up fs mock */
      },
      cleanup: () => {
        /* reset */
      },
    },
  },
});
```

### `targetCommands` (partial validation)

Validates/generates only specific command blocks, preserving the rest of the file. This is the basis for isolating per-command tests (different mocks per `it()`):

```typescript
await assertDocMatch({
  ...baseDocConfig,
  targetCommands: ["read"],
  examples: { read: { mock, cleanup } },
});
```

Partial validation operates on the single command marker pair (`<!-- politty:command:<path>:start --> … -->`). If a target command has no marker in an existing file and update mode is off, it errors and asks you to regenerate.

## Markers

Generated files contain exactly **one marker pair per command**:

```markdown
<!-- politty:command:deploy:start -->

## deploy

Deploy the project

...

<!-- politty:command:deploy:end -->
```

These delimit blocks for partial validation. Root documents and custom layouts are markerless apart from the command blocks emitted by `md.commands()`. There is no doctor mode.

## Migration

`npx politty-migrate` (a separate package) converts a project from the old marker-based setup to this API:

- 9-marker Markdown → one marker pair per command.
- Free text that lived between markers is lifted into `layout` / per-command override templates.
- `rootInfo`, `FileConfig.title` / `description` / `render`, and the per-section render callbacks are folded into `layout` (variable-referenced `files` declarations are resolved and migrated too).
- Anything it can't rewrite statically (shared-base spreads, unresolvable/computed values, custom renderers) gets a `// TODO(politty-migrate: <category>)` anchor plus a `politty-migrate.todo.md` playbook describing how to finish each category. The tool fails (non-zero exit) rather than emit invalid config silently.

After migrating, run `POLITTY_DOCS_UPDATE=true pnpm test` to regenerate the Markdown.

## Environment Variables

| Variable              | Description                                           |
| --------------------- | ----------------------------------------------------- |
| `POLITTY_DOCS_UPDATE` | Set to `true`/`1` to write/update documentation files |

## Exports

- `assertDocMatch`, `generateDoc`, `initDocFile` — main API
- `createCommandMd`, `createLayoutMd`, `formatTemplate` — the `md` tag building blocks
- `createCommandRenderer`, `defaultRenderers` — default rendering
- `renderUsage`, `renderArgumentsTable`/`renderArgumentsList`, `renderOptionsTable`/`renderOptionsList`, `renderSubcommandsTable`, `renderExamplesDefault` — section renderers
- `buildCommandInfo`, `collectAllCommands`, `resolveLazyCommand` — command info
- `renderArgsTable`, `renderCommandIndex` — global options / index
- `compareWithExisting`, `formatDiff`, `writeFile` — comparator utilities
- `commandStartMarker`, `commandEndMarker` — command marker helpers
- Types: `CommandInfo`, `CommandMd`, `LayoutMd`, `CommandOverride`, `CommandMap`, `FileConfig`, `FileMapping`, `RootDocConfig`, `PathConfig`, `GenerateDocConfig`, `GenerateDocResult`, `DefaultRendererOptions`, `ExampleConfig`, `FormatterFunction`, `RenderFunction`
