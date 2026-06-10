/**
 * The FIXED AI playbook emitted to `politty-migrate.todo.md`.
 *
 * The content is static and keyed by TODO category. After a best-effort
 * migration, the CLI lists the concrete TODO anchors it left in the source and
 * appends this playbook so an AI agent (or a human) can finish each one. The
 * playbook embeds a summary of the NEW markerless `md`-template API so the
 * reader needs no other context.
 */

import type { TodoCategory } from "./rewrite.js";

/** The NEW API summary embedded at the top of the playbook (fixed text). */
export const NEW_API_SUMMARY = `## New doc-template API (summary)

The docs system no longer uses 9 per-section markers. Each command is wrapped
in a SINGLE marker pair:

    <!-- politty:command:<path>:start --> ... <!-- politty:command:<path>:end -->

Root documents and file layouts are MARKERLESS — no \`global-options\`,
\`index\`, \`root-header\`, or \`root-footer\` markers exist anymore.

Config shape:

- \`files\`: \`Record<string, FileConfig>\`. A \`FileConfig\` is
  \`{ commands?, layout?, index?, noExpand? }\`. \`commands\` is a \`string[]\` (each
  path uses the default render) OR a \`CommandMap\`
  (\`Record<path, true | (md) => string>\`). There is no array-sugar or bare
  \`CommandMap\` value form — always wrap them in \`{ commands: ... }\`.
- A command value of \`true\` => default render. A function \`(md) => md\\\`...\\\`\`
  composes the block from section getters: \`md.description\`, \`md.usage\`,
  \`md.arguments\`, \`md.options\`, \`md.globalOptionsLink\`, \`md.subcommands\`,
  \`md.examples\`, \`md.notes\`, and \`md.h(level, text?)\` for headings.
- \`rootDoc.layout(md) => string\` and \`FileConfig.layout(md) => string\` build a
  markerless file body. On the root document, \`md.globalOptions\` and
  \`md.index\` are available; \`md.commands()\` emits the file's command blocks.
- \`FileConfig.index\` (\`{ title?, description? }\`) sets this file's curated entry
  in the root command index, replacing the OLD \`title\`/\`description\` (which the
  index used). Without it the index falls back to the first command's name.
- REMOVED: \`rootInfo\`, \`FileConfig.title\`, \`FileConfig.description\`,
  \`FileConfig.render\`, per-section \`format\` renderers, and doctor mode. The OLD
  \`title\`/\`description\` now map to \`FileConfig.index\` (root index) plus a
  \`layout\` heading (file body).

The \`md\` tag dedents, trims, and collapses blank-line runs, so absent sections
collapse cleanly.

Also update any TEST that hardcodes the OLD marker strings: search for
\`politty:command:\` assertions (e.g. \`:heading:start\` / \`:usage:start\`) and
replace them with the single \`<!-- politty:command:<path>:start -->\` pair.
\`politty migrate\` rewrites doc CONFIG, not arbitrary test assertions, so these
must be updated by hand.`;

/**
 * Fixed, always-included guidance for the most common static conversion:
 * \`FileConfig.title/description/render\` -> \`layout\`, and the variable-referenced
 * \`files\` case. The migrator does this automatically when it can; this section
 * documents the exact transform so an AI agent can finish the cases it flagged.
 */
export const FILECONFIG_GUIDE = `## FileConfig: \`title\`/\`description\`/\`render\` -> \`index\` + \`layout\`

The NEW \`FileConfig\` is \`{ commands?, layout?, index?, noExpand? }\`. The OLD keys
\`title\`, \`description\`, and \`render\` were REMOVED. The OLD \`title\`/\`description\`
served TWO roles — the file's entry in the root command index AND the file-body
heading — so they map to BOTH \`index\` and \`layout\`. Convert each entry as:

BEFORE (OLD, now invalid):

    const files: Record<string, FileConfig> = {
      "docs/cli/application.md": {
        title: "Application Commands",
        description: "Commands for managing applications.",
        commands: ["init", "deploy"],
        render: defaultRender,
      },
    };

AFTER (NEW):

    const files: Record<string, FileConfig> = {
      "docs/cli/application.md": {
        commands: ["init", "deploy"],
        index: {
          title: "Application Commands",
          description: "Commands for managing applications.",
        },
        layout: (md) =>
          md\`
            # Application Commands

            Commands for managing applications.

            \\\${md.commands()}
          \`,
      },
    };

Rules:
- \`title\`/\`description\` -> \`index: { title, description }\` (the root command
  index entry). If the file body had a DIFFERENT hand-written heading/prose,
  prefer that text in the \`layout\` and keep the curated \`index\` text separate.
- \`title\` -> also a leading \`# <title>\` line in the \`layout\`; \`description\` -> a
  paragraph after the heading.
- Always end the \`layout\` with \`\\\${md.commands()}\` so the file's command blocks
  still render. Omit the heading / description lines that were absent.
- \`render\`: if it is \`createCommandRenderer({})\` / \`createCommandRenderer({ headingLevel: 1 })\`
  (or a \`const\` bound to one), DROP it — the default renderer already matches.
  If it is a CUSTOM renderer, drop it from the \`FileConfig\` and reproduce its
  behavior with \`FileConfig.sections\` (a \`SectionsSpec\` applied to every command
  in the file — e.g. \`sections: { order: [...] }\` to change the section order,
  or \`{ remove: [...] }\` to drop sections). For per-command differences, use a
  \`(md) => md\\\`...\\\`\` override on that command instead. A \`layout-review\` TODO
  marks each custom-render entry.

### Variable-referenced \`files\`

When the call site passes \`files\` (or the whole config) BY NAME, e.g.
\`assertDocMatch({ command, files, ... })\` with a same-file
\`const files: Record<string, FileConfig> = { ... }\`, apply the conversion above
to that \`const\` declaration. The migrator resolves same-file \`const\`
object-literals automatically; a \`variable-ref\` TODO is left only when the
definition is in another module, is built dynamically, or is AMBIGUOUS — i.e.
more than one TOP-LEVEL \`const\` of that name exists, so the migrator refuses to
guess which one the call site means. In the ambiguous case, disambiguate the
declarations (rename or remove the duplicate) and migrate the intended one.`;

/** Fixed per-category guidance. */
const CATEGORY_GUIDE: Record<TodoCategory, string> = {
  "spread-config": `### spread-config

A config object spreads a shared base (e.g. \`{ ...baseConfig, ... }\`). The base
definition is not visible at the call site, so it may still carry removed keys
(\`rootInfo\`, or \`FileConfig.title\`/\`description\`/\`render\`).

To finish:
1. Open the base definition (the variable being spread).
2. Apply the same migration there: replace removed keys, convert \`files\`
   arrays/objects to the new \`CommandMap\`/\`FileConfig\` shape, and move any
   \`rootInfo\` header/description/footer text into a \`rootDoc.layout\`.
3. Re-run the doc test with \`POLITTY_DOCS_UPDATE=true\` and confirm the golden
   only changed markers.`,

  "variable-ref": `### variable-ref

The config (or one of its values) is a variable reference or call expression,
not an inline object literal, so it could not be rewritten in place.

To finish:
1. Locate the referenced definition (\`const docConfig = { ... }\` or the
   function that returns it).
2. Apply the \`files\`/\`rootDoc\` rewrite to that definition.
3. If the value is derived dynamically (built in a function), reconstruct an
   equivalent static \`CommandMap\`/\`layout\`, or keep the dynamic builder but
   ensure it returns the new shape.`,

  "dynamic-key": `### dynamic-key

A \`files\` (or \`path\`) map uses a computed key like \`[somePath]: [...]\`. The
migrator left the key untouched.

To finish:
1. Confirm the computed key resolves to a string path — the new \`FileMapping\`
   still accepts any string key, so a computed string key is fine.
2. Convert the VALUE (the command list) to the new \`CommandMap\`/\`FileConfig\`
   shape if it carried a custom \`render\`/\`title\`/\`description\`.`,

  "layout-review": `### layout-review

A generated \`layout\` / command override needs a human eye. This happens when
free text was interleaved between sections (the old parser cannot always place
it precisely), when sections were reordered, or when \`rootInfo\`
header/description/footer text was folded into \`rootDoc.layout\`.

To finish:
1. Open the generated \`(md) => md\\\`...\\\`\` template.
2. Check that free text sits where it did in the original document, and that
   section getters (\`md.usage\`, \`md.options\`, …) are in the intended order.
3. Re-run with \`POLITTY_DOCS_UPDATE=true\`; the golden diff must be
   marker-only.`,
};

export interface PlaybookTodoEntry {
  category: TodoCategory;
  file: string;
  detail: string;
  /** 1-based line number of the anchor. */
  line?: number;
}

/**
 * Render the full `politty-migrate.todo.md` content. Always includes the API
 * summary; includes only the category sections that have at least one TODO.
 */
export function renderPlaybook(entries: PlaybookTodoEntry[]): string {
  const header = `# politty migrate — follow-up TODOs

This file was generated by \`politty migrate\`. The migration applied
best-effort edits and left \`// TODO(politty-migrate: <category>)\` anchors where
it could not safely finish automatically. Resolve each anchor below, then
re-run your doc tests with \`POLITTY_DOCS_UPDATE=true\`.

${NEW_API_SUMMARY}

${FILECONFIG_GUIDE}

## Outstanding items`;

  const byCategory = new Map<TodoCategory, PlaybookTodoEntry[]>();
  for (const e of entries) {
    const list = byCategory.get(e.category) ?? [];
    list.push(e);
    byCategory.set(e.category, list);
  }

  const order: TodoCategory[] = ["spread-config", "variable-ref", "dynamic-key", "layout-review"];

  const sections: string[] = [];
  if (entries.length === 0) {
    sections.push("\nNo follow-up items — the migration was fully automatic.");
  } else {
    for (const category of order) {
      const list = byCategory.get(category);
      if (!list || list.length === 0) continue;
      const items = list
        .map((e) => `- \`${e.file}\`${e.line ? `:${e.line}` : ""} — ${e.detail}`)
        .join("\n");
      sections.push(`\n${CATEGORY_GUIDE[category]}\n\nAnchors:\n${items}`);
    }
  }

  return `${header}\n${sections.join("\n")}\n`;
}
