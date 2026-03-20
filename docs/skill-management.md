# Skill Management

politty provides a `withSkillCommand` wrapper that adds agent skill management to your CLI. It wraps [vercel-labs/skills](https://github.com/vercel-labs/skills), handling source directory scanning and skill filtering while delegating actual installation to `npx skills`.

## Overview

politty's role is focused:

1. **Install**: Scans your source directory for SKILL.md files and provides their local paths to `npx skills add`
2. **Remove**: Filters removal to only skills defined in your source directory

The actual installation destination (`.claude/skills/`, `.cursor/skills/`, etc.) is determined by vercel-labs/skills.

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

### 2. Write SKILL.md

Each skill is a directory containing a SKILL.md with YAML frontmatter:

```markdown
---
name: commit
description: Git commit message generation
package: "my-agent"
---

# Commit Skill

Generate conventional commit messages from staged changes.
```

**Required fields:** `name`, `description`

**Optional fields:** `package` (tracks which npm package the skill came from), `metadata` (arbitrary key-value pairs)

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
  { sourceDir },
);

runMain(cli);
```

> **Note:** Use `import.meta.url` for path resolution so it works from both source (`src/`) and built (`dist/`) files.

## Commands

### `skills sync`

Removes all skills from this package, then reinstalls them. Ensures installed skills match the current source.

```bash
my-agent skills sync
my-agent skills sync --exclude commit    # Skip specific skills
my-agent skills sync -e commit -e review # Skip multiple skills
```

### `skills add`

Install a specific skill or all skills:

```bash
my-agent skills add commit
my-agent skills add --all
```

### `skills remove`

Remove a specific skill or all skills provided by this CLI:

```bash
my-agent skills remove commit
my-agent skills remove --all
```

### `skills list`

List available skills from the source directory:

```bash
my-agent skills list
my-agent skills list --json
```

## Programmatic API

The scanning and parsing utilities are exported for programmatic use:

```typescript
import { scanSourceDir, parseSkillMd } from "politty/skill";

// Discover skills
const skills = scanSourceDir("./skills");
for (const skill of skills) {
  console.log(skill.frontmatter.name, skill.sourcePath);
}

// Parse a single SKILL.md
const parsed = parseSkillMd(content);
if (parsed) {
  console.log(parsed.frontmatter.name);
  console.log(parsed.body);
}
```

## SKILL.md Format

Compatible with [vercel-labs/skills](https://github.com/vercel-labs/skills). The frontmatter parser supports:

- String values: `name: commit`
- Quoted strings: `package: "@my-agent/skills"`
- Booleans: `enabled: true`
- Numbers: `priority: 10`
- Flow-style arrays: `tags: [git, commit]`
- Nested objects (one level):
  ```yaml
  metadata:
    internal: true
  ```
