# Skill Management

politty provides a `withSkillCommand` wrapper that adds agent skill management to your CLI. It handles source-directory scanning, spec validation, and symlink-or-copy installation of SKILL.md-based skills.

SKILL.md files are validated against the [Agent Skills specification](https://agentskills.io/specification).

## Overview

politty's role is focused:

1. **Install**: Scans your source directory for SKILL.md files and populates `.agents/skills/<name>` for each one (typically pointing into `node_modules/<pkg>/skills/<name>`). Agent-specific directories (e.g. `.claude/skills/<name>`) are populated from that canonical path so a single `sync` replaces both hops at once. The materialization strategy is controlled by `mode`:
   - **`"symlink"` (default)** — symlink the source into place. Source updates propagate live. On filesystems without symlink support (e.g. Windows without Developer Mode, some network filesystems), install fails with a clear error pointing at `mode: "copy"` as the fix.
   - **`"copy"`** — recursive copy. Source updates require re-running `sync`, but works on every filesystem.

2. **Validate ownership**: The source SKILL.md must pre-declare `metadata["politty-cli"] = "{package}:{cliName}"`. The `skills add` and `skills sync` subcommands verify the stamp before installing, so two tools managing skills in the same project cannot accidentally clobber each other. The `installSkill` primitive itself does not compare ownership (it doesn't know who you are), but in `mode: "copy"` it does require the source SKILL.md to carry a `politty-cli` stamp at all — without one the call throws so a second install isn't stuck on the "Refusing to replace non-symlink" guard. Programmatic callers that bypass `withSkillCommand` are still responsible for matching the stamp against their own `{package}:{cliName}`. politty never writes to your SKILL.md.
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

**You must pre-declare `metadata["politty-cli"]: "{package}:{cliName}"` in the source SKILL.md.** The `skills add` and `skills sync` subcommands validate that the source stamp matches the `package` option you pass to `withSkillCommand` combined with your command's `name`, and refuse to install otherwise. (The `installSkill` primitive itself does not compare ownership; callers using it programmatically are responsible for matching the stamp against their `{package}:{cliName}`. The primitive additionally throws in `mode: "copy"` when the source has no `politty-cli` stamp at all, so direct callers see an actionable packaging error instead of a "Refusing to replace non-symlink" failure on the second install.) politty never writes to your SKILL.md — the stamp is authored by you at package time, not rewritten at install time. Copy-mode installs still carry the stamp because the source SKILL.md is copied verbatim.

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

### Install root resolution

Every `skills` subcommand resolves an install root for `.agents/skills/...` once per invocation. The default walks up from `process.cwd()` and uses the first ancestor that contains `.git/` (a directory **or** a worktree/submodule pointer file) or `package.json`, falling back to `process.cwd()` when neither is found. This avoids creating `<sub>/.agents/skills/...` when the CLI is invoked from a project subdirectory.

Pass an explicit `cwd` to override — useful when the CLI ships its own config file and should treat that file's location as the project root:

```ts
withSkillCommand(cmd, {
  sourceDir,
  package: "@my-agent/skills",
  cwd: dirname(configFilePath), // override find-up
});
```

The programmatic primitives (`installSkill`, `uninstallSkill`, `hasInstalledSkill`, `readInstalledOwnership`) keep their original `process.cwd()` default — find-up is only applied by `withSkillCommand`'s subcommands so direct callers see no behavior change.

## Commands

### `skills sync`

Removes and reinstalls all skills owned by this CLI. Skills your CLI previously installed but no longer bundles are removed as orphans. Skills owned by other tools are left untouched.

```bash
my-agent skills sync
my-agent skills sync --exclude commit    # Skip specific skills
my-agent skills sync -x commit -x review # Skip multiple skills (short alias)
my-agent skills sync --verbose           # Print install path and mode
```

The short alias for `--exclude` is `-x` by default. If your CLI's global
flags already use `-x`, override or disable it via `flags.exclude.alias`:

```ts
withSkillCommand(cmd, {
  sourceDir,
  package: "@my-agent/skills",
  flags: { exclude: { alias: "X" } }, // rename
  // flags: { exclude: { alias: false } }, // or disable entirely
});
```

### Resolving flag and alias collisions with a host CLI

`skills add`/`skills sync` also define `--verbose`/`-v`, and `skills list`
defines `--json`. If your host CLI already has global flags of the same
name, pass the same `globalArgs` schema you give to `runMain`/`runCommand`
as `globalArgs` here too, and the collision resolves itself:

```ts
const globalArgs = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
});

const cli = withSkillCommand(baseCommand, {
  sourceDir,
  package: "@my-agent/skills",
  globalArgs, // skills add/sync auto-detect verbose and drop their own --verbose
});

runMain(cli, { globalArgs }); // same schema passed to the real entry point
```

Because `globalArgs` already declares a `verbose` field, `withSkillCommand`
automatically omits `skills add`/`skills sync`'s own `--verbose` (same for
`json` on `skills list`), and the host's global value takes priority for
those subcommands too — no manual `flags.verbose.disabled` needed.

Note that _keeping_ a local field of the same name instead does not
reliably achieve the same thing: a global flag typed before the subcommand
(`mycli --verbose skills add`, the natural position for a global flag)
resolves correctly at the global level, but the local schema's own default
value then overwrites it during the final merge, silently discarding what
the user typed. This is exactly why `withSkillCommand` auto-omits the
local field instead of just letting both coexist.

`--verbose`'s short alias can still collide independently of the field-name
auto-detection above — e.g. the host's `globalArgs` uses `-v` for an
unrelated flag (not named `verbose`), so auto-detection doesn't kick in,
but the single-character alias still clashes. Rename it via
`flags.verbose.alias`:

```ts
withSkillCommand(cmd, {
  sourceDir,
  package: "@my-agent/skills",
  flags: { verbose: { alias: "V" } },
});
```

(`skills list --json` has no default alias, so there's nothing to rename
there — `globalArgs` auto-detection is the only lever for `--json`.)

The primary name and backward-compatibility aliases of `skills add`/`skills
remove` can be customized via `commandMap`. In each array, the _first_
element becomes the subcommand's dispatched name; the rest become aliases:

```ts
withSkillCommand(cmd, {
  sourceDir,
  package: "@my-agent/skills",
  commandMap: {
    add: ["add", "install", "get"], // keep "add"/"install", add "get"
    remove: ["remove"], // drop the "uninstall" alias entirely
  },
});
```

Renaming the primary name outright works the same way — put the new name
first:

```ts
withSkillCommand(cmd, {
  sourceDir,
  package: "@my-agent/skills",
  commandMap: {
    add: ["setup", "add", "install"], // dispatches as "setup"; "add"/"install" still work
  },
});
```

### Unknown-flag strictness

By default, an unrecognized flag on any `skills` subcommand (e.g.
`skills add --typo`) prints a warning and is dropped — matching politty's
own `z.object()` default. If your host CLI uses `z.strictObject()`/
`.strict()` throughout and wants the same behavior here, set
`unknownKeys: "strict"` to make it a hard error instead. `"passthrough"` is
also available — it behaves exactly like `"strip"` (the flag's value is
still dropped, not preserved anywhere) but suppresses the warning:

```ts
withSkillCommand(cmd, {
  sourceDir,
  package: "@my-agent/skills",
  unknownKeys: "strict",
});
```

This applies uniformly to `add`/`sync`/`remove`/`list` and only affects
flags the parser can't attribute to this subcommand or to `globalArgs` — a
value that legitimately arrives via `globalArgs` is validated separately
and merged in afterward, so `unknownKeys: "strict"` never rejects it.

### `skills add` (alias: `install`)

Install one or more named skills, or all skills when no name is given. Multiple positional names are pre-validated against the source directory before any install side effect — any unknown name aborts the run with a single error listing every typo, so the whole invocation can be fixed in one round-trip.

```bash
my-agent skills add commit
my-agent skills install commit        # `install` is an alias for `add`
my-agent skills add commit review-pr  # Install several at once
my-agent skills add                   # Install all skills
my-agent skills add --verbose         # Print install path and mode per skill
```

### `skills remove` (alias: `uninstall`)

Remove a specific skill, or every source skill discovered in `sourceDir` when no name is given. Only skills whose `metadata["politty-cli"]` matches `"{package}:{cliName}"` are removed. The no-argument form iterates the current source bundle, so an installed orphan (a skill this CLI previously installed but no longer ships in `sourceDir`) is **not** swept by `remove`; use `skills sync` for orphan reconciliation, or name the orphan explicitly.

```bash
my-agent skills remove commit
my-agent skills uninstall commit   # `uninstall` is an alias for `remove`
my-agent skills remove             # Remove every skill currently in sourceDir that this CLI owns
```

### `skills list`

List available skills from the source directory:

```bash
my-agent skills list
my-agent skills list --json
```

`--json` emits `{ name, description, owner, expectedOwner, status, sourcePath }` per skill. `owner` is what the source SKILL.md actually declares under `metadata["politty-cli"]` (may be `null`); `expectedOwner` is `"{package}:{cliName}"`. A mismatch means `skills add` will refuse to install.

`status` is one of:

- `installed` — `.agents/skills/<name>` is stamped by this CLI.
- `not-installed` — `.agents/skills/<name>` is absent.
- `foreign` — installed but stamped by another CLI; `add`/`sync` will refuse to overwrite it.
- `unstamped` — installed without a `politty-cli` stamp (legacy or manual install, or a real directory at the slot with no readable SKILL.md); `add` refuses to clobber it.
- `missing` — `.agents/skills/<name>` is a dangling canonical symlink whose target still routes into this CLI's `sourceDir` (i.e. our source package was uninstalled); `remove` / `sync` can clean it up. A dangling symlink whose target lies outside our `sourceDir` belongs to another politty-based CLI in the shared `.agents/skills/` namespace and is reported as `unstamped` instead, since this CLI's cleanup path refuses to touch it.
- `unreadable` — slot's SKILL.md exists but reading it failed (EACCES / EPERM / IO). Distinct from `unstamped` so the underlying cause (permissions, broken file) is actionable; a warning is also logged.

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
// metadata["politty-cli"]; installSkill installs it without rewriting
// any file — symlinking the source in by default, or recursively copying
// when mode is "copy".
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

## Filesystem Behavior

### Symlink target convention

`installSkill` writes **relative** symlink targets so the install survives copying or remounting the project tree at a different absolute path. The two endpoints are resolved asymmetrically:

- The install root (`.agents/skills/`, each agent-specific slot's parent) is passed through `realpathSync`, so a symlinked checkout or other parent-side hop doesn't bake a stale absolute path into the relative target.
- The source path is resolved by walking root → leaf and `realpathSync`-resolving every ancestor symlink (a symlinked checkout, macOS `/tmp` → `/private/tmp`, etc.) — **except** a `node_modules/<pkg>` (or `node_modules/@scope/<pkg>`) symlink, which is preserved verbatim from that point onward. The project-root portion ends up in the same realpath style as the install root (so a copy/remount keeps both ends in sync), but the package manager hop is kept intact so a subsequent `pnpm update` that swaps the `.pnpm/<pkg>@<version>_<hash>/...` hashed directory doesn't leave every installed skill dangling.

The overlap guard and the copy-mode payload still operate on the fully `realpathSync`-resolved source — the guard needs to catch a source-side symlink whose target is nested inside the install root, and the copy-mode payload reads through every symlink so a copy install doesn't leave dangling references back into `node_modules`. No absolute-path symlinks are produced.

### Atomicity & retry

A single `installSkill` call is **not transactional**. It clears and writes the canonical `.agents/skills/<name>` slot, then clears and writes each agent-specific slot in sequence. A crash mid-call can leave some slots updated and others stale.

Multi-skill `skills sync` is **fail-fast**: the first failed skill aborts the loop without rolling back already-installed siblings. Both single- and multi-skill operations are idempotent — re-running `skills sync` (or `skills add <name>`) converges back to the intended state. There is no per-skill rollback because the ownership stamp guarantees re-runs only ever touch slots this CLI owns.

If you need stronger atomicity for, say, a release pipeline, gate the install with a higher-level lock and treat a non-zero exit code as "retry the entire `sync`."

### Windows / no-symlink filesystems

On filesystems without symlink support (Windows without Developer Mode, some network filesystems), `mode: "symlink"` (the default) throws a clear error pointing at `mode: "copy"`. Switch the mode at the `withSkillCommand` call site, or override per skill via the programmatic API:

```ts
withSkillCommand(cmd, {
  sourceDir,
  package: "@my-agent/skills",
  mode: "copy",
});
```

Copy mode is fully self-contained: the materialised `.agents/skills/<name>` carries the source SKILL.md verbatim (including the `politty-cli` stamp), so subsequent `remove`/`sync` ownership checks behave identically to symlink mode.

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
