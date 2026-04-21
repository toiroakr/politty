# Skill Management

politty provides a `withSkillCommand` wrapper that adds agent skill management to your CLI. It handles source-directory scanning, spec validation, and file-based installation of SKILL.md-based skills.

SKILL.md files are validated against the [Agent Skills specification](https://agentskills.io/specification).

## Overview

politty's role is focused:

1. **Install**: Scans your source directory for SKILL.md files, copies each to `.agents/skills/<name>/`, and creates symlinks from agent-specific directories (e.g. `.claude/skills/`). The copy is staged in a temporary sibling directory and `rename`d into place so partial copies can never be observed; replacing an existing installation removes the old directory first, so the skill path may be briefly absent during the swap. If `symlink` is unavailable (e.g. Windows without Developer Mode), `.claude/skills/<name>` is created as a real copy rather than a link — a subsequent `skills sync` is needed to propagate changes from `.agents/skills/` into those copies.
2. **Stamp**: Each installed SKILL.md is stamped with `metadata["politty-cli"] = "{package}:{cliName}"` so politty can tell apart skills your CLI owns from skills another tool manages.
3. **Remove safely**: `skills remove` and `skills sync` refuse to delete skills that don't carry your CLI's stamp, protecting projects that use multiple skill-providing tools.

## Setup

### 1. Create skill files

Place SKILL.md files in a `skills/` directory alongside your source:

```
my-agent/
├── src/
│   └── index.ts
├── dist/
│   └── index.js
└── skills/
    ├── commit/
    │   └── SKILL.md
    └── review-pr/
        └── SKILL.md
```

The subdirectory name **must** equal the frontmatter `name` (Agent Skills spec requirement). Skills whose name does not match are skipped with a warning.

### 2. Write SKILL.md

Each skill is a directory containing a SKILL.md with YAML frontmatter:

```markdown
---
name: commit
description: Git commit message generation
license: MIT
---

# Commit Skill

Generate conventional commit messages from staged changes.
```

**Required fields:** `name`, `description`

**Optional fields (spec):** `license`, `compatibility` (<=500 chars), `metadata` (string->string map), `allowed-tools` (experimental).

**Constraints:**

- `name` matches `^[a-z0-9]+(-[a-z0-9]+)*$`, 1..64 chars
- `description` is 1..1024 chars
- Unknown top-level fields are preserved (round-tripped via `.passthrough()`)

You do not need to write `metadata["politty-cli"]` yourself — the installer sets it at install time based on the `package` option you pass to `withSkillCommand`.

### 3. Add withSkillCommand

```typescript
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineCommand, runMain } from "politty";
import { withSkillCommand } from "politty/skill";

// ../skills resolves correctly from both src/ and dist/
const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)), "../skills");

const cli = withSkillCommand(
  defineCommand({
    name: "my-agent",
    description: "My coding agent CLI",
    subCommands: {
      /* ... */
    },
  }),
  { sourceDir, package: "@my-agent/skills" },
);

runMain(cli);
```

> **Note:** Use `import.meta.url` for path resolution so it works from both source (`src/`) and built (`dist/`) files.

The `package` option identifies who owns the installed skills. It is combined with the command name as `"{package}:{cliName}"` and stamped onto each installed SKILL.md under `metadata["politty-cli"]`.

## Commands

### `skills sync`

Removes and reinstalls all skills owned by this CLI. Skills your CLI previously installed but no longer bundles are removed as orphans. Skills owned by other tools are left untouched.

```bash
my-agent skills sync
my-agent skills sync --exclude commit    # Skip specific skills
my-agent skills sync -e commit -e review # Skip multiple skills
```

### `skills add`

Install a specific skill, or all skills when no name is given. A typo in the name errors out even if the source directory is misconfigured or empty.

```bash
my-agent skills add commit
my-agent skills add            # Install all skills
```

### `skills remove`

Remove a specific skill, or all skills discovered in `sourceDir` when no name is given. Only skills whose `metadata["politty-cli"]` matches `"{package}:{cliName}"` are removed.

```bash
my-agent skills remove commit
my-agent skills remove         # Remove all skills owned by this CLI
```

### `skills list`

List available skills from the source directory:

```bash
my-agent skills list
my-agent skills list --json
```

`--json` emits `{ name, description, owner, sourcePath }` per skill.

## Programmatic API

The scanning, parsing, and install primitives are exported for programmatic use:

```typescript
import { scanSourceDir, parseSkillMd, installSkill, readInstalledOwnership } from "politty/skill";

// Discover skills (collects validation errors instead of throwing)
const { skills, errors } = scanSourceDir("./skills");
for (const err of errors) console.warn(err.message);
for (const skill of skills) console.log(skill.frontmatter.name, skill.sourcePath);

// Parse a single SKILL.md
const parsed = parseSkillMd(content);
if (parsed) {
  console.log(parsed.frontmatter.name);
  console.log(parsed.body);
}

// Install one explicitly; you must supply the ownership stamp
installSkill(skills[0], "@my-agent/skills:my-agent");

// Read the ownership stamp of an installed skill
readInstalledOwnership("commit"); // "@my-agent/skills:my-agent" | null
```

## SKILL.md Format

The frontmatter parser accepts standard YAML. Values pass through to Zod validation, which enforces the Agent Skills spec's type and length constraints. Unknown top-level keys are preserved.

A UTF-8 byte-order mark at the start of the file is tolerated.

```markdown
---
name: commit
description: Generate commit messages
license: MIT
compatibility: "claude-code>=1.0"
metadata:
  owner: alice
---

# Instructions...
```
