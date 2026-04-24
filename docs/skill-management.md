# Skill Management

politty provides a `withSkillCommand` wrapper that adds agent skill management to your CLI. It handles source-directory scanning, spec validation, and symlink-or-copy installation of SKILL.md-based skills.

SKILL.md files are validated against the [Agent Skills specification](https://agentskills.io/specification).

## Overview

politty's role is focused:

1. **Install**: Scans your source directory for SKILL.md files and populates `.agents/skills/<name>` for each one (typically pointing into `node_modules/<pkg>/skills/<name>`). Agent-specific directories (e.g. `.claude/skills/<name>`) are populated from that canonical path so a single `sync` replaces both hops at once. The materialization strategy is controlled by `mode`:
   - **`"symlink"` (default)** — symlink the source into place. Source updates propagate live. On filesystems without symlink support (e.g. Windows without Developer Mode, some network filesystems), install fails with a clear error pointing at `mode: "copy"` as the fix.
   - **`"copy"`** — recursive copy. Source updates require re-running `sync`, but works on every filesystem.

2. **Validate ownership**: The source SKILL.md must pre-declare `metadata["politty-cli"] = "{package}:{cliName}"`. The `skills add` and `skills sync` subcommands verify the stamp before installing, so two tools managing skills in the same project cannot accidentally clobber each other. The `installSkill` primitive itself performs no stamp validation — programmatic callers that bypass `withSkillCommand` are responsible for that check. politty never writes to your SKILL.md.
3. **Remove safely**: `skills remove` and `skills sync` refuse to delete skills that don't carry your CLI's stamp, protecting projects that use multiple skill-providing tools. Real directories (copy-mode installs) are only removed when their SKILL.md still carries the expected ownership stamp — legacy or foreign installs are left untouched.

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
metadata:
  politty-cli: "@my-agent/skills:my-agent"
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

**You must pre-declare `metadata["politty-cli"]: "{package}:{cliName}"` in the source SKILL.md.** The `skills add` and `skills sync` subcommands validate that the source stamp matches the `package` option you pass to `withSkillCommand` combined with your command's `name`, and refuse to install otherwise. (The `installSkill` primitive itself performs no stamp validation; callers using it programmatically are responsible for that check.) politty never writes to your SKILL.md — the stamp is authored by you at package time, not rewritten at install time. Copy-mode installs still carry the stamp because the source SKILL.md is copied verbatim.

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
  {
    sourceDir,
    package: "@my-agent/skills",
    // mode: "symlink" (default) — source updates propagate live. Throws
    //   with guidance to retry with "copy" on filesystems without symlink
    //   support (e.g. Windows without Developer Mode).
    // mode: "copy" — recursive copy; works anywhere, source updates require
    //   re-running `skills sync`.
  },
);

runMain(cli);
```

> **Note:** Use `import.meta.url` for path resolution so it works from both source (`src/`) and built (`dist/`) files.

The `package` option identifies who owns the installed skills. It is combined with the command name as `"{package}:{cliName}"` and compared against the source SKILL.md's `metadata["politty-cli"]` stamp — installation fails if they don't match.

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

`--json` emits `{ name, description, owner, expectedOwner, sourcePath }` per skill. `owner` is what the source SKILL.md actually declares under `metadata["politty-cli"]` (may be `null`); `expectedOwner` is `"{package}:{cliName}"`. A mismatch means `skills add` will refuse to install.

## Programmatic API

The scanning, parsing, and install primitives are exported for programmatic use:

```typescript
import {
  scanSourceDir,
  parseSkillMd,
  installSkill,
  readInstalledOwnership,
  hasInstalledSkill,
} from "politty/skill";

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

// Install one explicitly. The source SKILL.md must already declare
// metadata["politty-cli"]; installSkill symlinks it into place verbatim
// and does not rewrite any file.
installSkill(skills[0]);
// Force a recursive copy instead of a symlink:
installSkill(skills[0], undefined, { mode: "copy" });

// Read the ownership stamp of an installed skill (via its symlink target)
readInstalledOwnership("commit"); // "@my-agent/skills:my-agent" | null

// Presence check independent of ownership — true for both stamped installs
// and unstamped legacy/manual installs; false for "not installed" and for
// broken canonical symlinks (source package uninstalled).
hasInstalledSkill("commit"); // boolean
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
  politty-cli: "@my-agent/skills:my-agent"
  owner: alice
---

# Instructions...
```
