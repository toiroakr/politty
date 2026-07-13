# politty

## 0.11.3

### Patch Changes

- bc7bcfc: Add `SkillCommandOptions.descriptions` to override the description text of the `skills` command and each of its built-in subcommands (`sync`/`add`/`remove`/`list`), letting a host CLI brand the skills command without re-wrapping the command tree by hand. Keys refer to the subcommand's canonical role, independent of any `commandMap` rename — `descriptions.add` still applies after `commandMap.add` renames the subcommand to something else. Omitting `descriptions` (or any of its keys) preserves politty's existing default text exactly.

## 0.11.2

### Patch Changes

- 21e5dce: Add `args.$source(name)` to expose whether a resolved arg value came from an explicit CLI token (`"cli"`), a `field.env` fallback (`"env"`), or neither (`"default"`). This lets a command's `run()` handler distinguish an explicitly-typed value from an environment-variable fallback without re-deriving flag spellings from the schema, and works correctly for `positional` fields even when the typed value happens to equal the env var. `$source` correctly resolves both camelCase and kebab-case field name lookups, and correctly reports `"default"` for a local field that collides with a same-named global field but is resolved via the local schema's own default.

  `$source`'s parameter is typed as a plain `string` rather than a schema-derived key, since a stricter type broke type-checking for the documented discriminated-union `args` pattern.

  Field names starting with `"$"` are now rejected at command-definition time (`ReservedFieldNameError`), since that prefix is reserved for framework-injected helpers like `$source` and is unusable as a real CLI flag anyway (an unquoted `$name` gets shell-expanded before the program sees it).

- c199535: Fix global/local arg collisions on a shared field name. Two changes:

  - Command definitions where a global field and a same-named local field have different definitions (different type bucket, positional vs. flag, or different enum values) now throw `FieldTypeConflictError` at validation time — previously this silently passed even though the two fields didn't actually agree on what values are valid.
  - When the definitions are identical, a flag shared between `globalArgs` and a command's own schema now resolves correctly regardless of where it's typed — including when the command's own field is required and has no default. Previously, typing the flag _before_ the subcommand parsed it correctly as the global value, but the command's own same-named field — having received nothing of its own — would either fail local validation (if required) or unconditionally get overwritten by its own default during the final args merge, discarding what the user actually typed. Typing the same flag _after_ the subcommand already worked correctly and is unaffected.

  Also fixes an unrelated bug found while implementing the above: a `prompt` resolver returning `{ field: undefined }` for a field it chose not to prompt for could previously clobber a real CLI/env value already provided for that field.

  Two smaller follow-ups to the same-name conflict detection:

  - `validateCommand()` now accepts a `globalArgs` option and checks every command and subcommand in the tree against it, so a `FieldTypeConflictError`/case-variant collision on a rarely-invoked subcommand can be caught upfront instead of only at the moment that subcommand actually gets parsed.
  - The same-named field comparison now also considers whether the field is positional, so a global flag and a same-named local positional argument are correctly treated as conflicting rather than as identical.

- 48d54d9: Improve `withSkillCommand`'s type safety and customizability for host CLIs:

  - `withSkillCommand`'s return type now reflects the injected `skills` subcommand (`subCommands.skills` is typed as `AnyCommand` and no longer optional), so consumers no longer need an `as AnyCommand` cast to access it.
  - `SkillCommandOptions.globalArgs` accepts the same schema passed to `runMain`/`runCommand`'s `globalArgs`. When it already declares a same-named _non-positional boolean_ `verbose`/`json` field, `skills add`/`skills sync`'s `--verbose` and `skills list`'s `--json` are automatically omitted from their own schema, so the host's global flag of the same name takes priority — no manual configuration needed. (A same-named non-boolean field doesn't trigger this; politty itself rejects that combination with `FieldTypeConflictError` at parse time, so such a field must be renamed on one side instead.)
  - `SkillFlagOverrides.verbose.alias` renames or disables `skills add`/`skills sync --verbose`'s short alias — a collision independent of `globalArgs`'s field-name auto-detection (e.g. the host's `-v` belongs to an unrelated flag, not one named `verbose`).
  - `SkillCommandOptions.commandMap` lets a host CLI rename `skills add`/`skills remove` and control their aliases: `{ add?: string[]; remove?: string[] }`, where the first array element becomes the subcommand's dispatched name and the rest become aliases. Default: `add: ["add", "install"]`, `remove: ["remove", "uninstall"]`. `withSkillCommand` throws if any resulting name or alias collides with `sync`/`list` or with each other, or isn't a safe token (empty string, leading dash, whitespace, etc.).
  - `SkillCommandOptions.unknownKeys` (`"strict"` \| `"strip"` \| `"passthrough"`, default `"strip"`) controls unknown-flag handling for `add`/`sync`/`remove`/`list`'s own schemas uniformly — set `"strict"` to match a host CLI that uses `z.strictObject()` throughout. `"passthrough"` matches `z.object().passthrough()`: no warning, but (unlike `"strip"`) the flag's value is kept on the parsed args under its raw CLI name instead of dropped. Never affects values that legitimately arrive via `globalArgs`.

## 0.11.1

### Patch Changes

- cdab697: Fix two argv-parsing bugs that silently produced wrong values instead of erroring:

  - An option expecting a value (e.g. `z.coerce.number()`) followed by a negative-number-looking token, such as `--count -5`, no longer treats the flag as boolean `true` and mis-parses the following token as combined short flags. The token is now consumed as the option's value. Other dash-prefixed tokens (`--`, or another flag like `--verbose`) are left alone so they aren't silently swallowed as a literal value.
  - `--flag=true` / `--flag=false` now correctly coerce to booleans for `z.boolean()`-typed fields instead of failing validation with "expected boolean, received string".

- c69cee6: Fix the internal-subcommand bypass in `runMain` incorrectly matching prototype-inherited property names such as `__proto__`, `__defineGetter__`, or `__lookupGetter__`. Previously, invoking a CLI with one of these as the first positional (e.g. `mycli __proto__`) would silently skip the user-provided `setup`/`cleanup`/`prompt` hooks even though no such subcommand was ever registered, because the lookup read through `Object.prototype` instead of checking for an own property.
- fd67602: Fix `engines.node` to accurately reflect the runtime requirement. The package uses `node:util`'s `styleText`, which was added in Node 20.12.0 / 21.7.0; the previous `>=18` declaration allowed installs that crashed on import with `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`. The build target was also updated from `node18` to `node20.12` to match.
- 6515894: Fix subcommand resolution (`resolveSubcommand`, `resolveSubcommandWithAlias`, and the shell-completion context parser) incorrectly matching prototype-inherited property names such as `__proto__` or `constructor` as if they were registered subcommands. This follows up on the same class of bug fixed in `runMain`'s internal-subcommand bypass, applying the `Object.hasOwn` guard to the remaining lookups that read through `Object.prototype`.
- df62418: Add the missing MIT LICENSE file (the package has declared `"license": "MIT"` without shipping the license text) and set the previously empty `author` field in `package.json`. Also remove the stale `package-lock.json` that had been accidentally committed to this pnpm-managed project, and pin the `pkg-pr-new` preview-publish tool to an exact version instead of running `pnpm dlx`'s latest unconditionally in a `pull-requests: write` job.

## 0.11.0

### Minor Changes

- 50013d2: Disable default boolean negation unless `negation: true` is set.

  Boolean options no longer accept `--no-<name>` or `--no<Name>` by default. Set `negation: true` to enable and advertise the default negation form, set `negation` to a string to use a custom negation name, or leave it unset / set it to `false` to reject default negation.

## 0.10.1

### Patch Changes

- b4b1dd0: `onUnknownSubcommand` is no longer invoked for a command that defines its own `run`. Such a command's first positional is a real argument, so an installed `<cli>-<name>` plugin must never shadow it — which previously could make the command's meaning depend on what was on PATH. Plugin dispatch now only happens for pure subcommand-group commands (no `run`).

## 0.10.0

### Minor Changes

- b45b891: Positional tokens not consumed by the schema are now surfaced rather than silently ignored.

  For commands with subcommands, any unconsumed bare token that is not a known subcommand name is treated as an unknown subcommand attempt and exits with code 1 (with a did-you-mean suggestion when a similar name exists). Tokens after `--`, dash-prefixed tokens, and tokens that match a known subcommand name are excluded from this check — they fall through to the `unknownKeysMode` positional handling instead.

  For commands without subcommands, behaviour follows the schema's `unknownKeysMode`:

  - `strict` (`z.strictObject` / `.strict()`): exits with code 1
  - `strip` / default (`z.object`): emits a warning and continues
  - `passthrough` (`z.looseObject` / `.passthrough()`): silently ignores (no change)

  Schema-less commands (no `args` defined) now correctly capture all tokens — including flag-like ones such as `-x` — as positionals so stray tokens are still detected.

### Patch Changes

- ebbd553: Extract shared `resolveLongOption()` for long-option resolution, eliminating duplicated negation rules between argv-parser and subcommand-scanner.
- 0429277: Unify the options-rendering paths in `src/docs` through a shared `(rows × columns)` intermediate (`toOptionRows` + `emitMarkdownTable`/`emitMarkdownList`). The markdown table and list renderers, their `*FromArray` variants, and `renderArgsTable`'s column-filtered path now share one place where per-option display decisions (negation handling, alias ordering, placeholder resolution) live.

  Rendered output is unchanged except for one cosmetic detail: `renderArgsTable(args, { columns })` now emits the canonical fixed-width table separator (`|--------|...`) instead of header-length, space-padded dashes (`| ------ | ... |`). The two forms render identically as Markdown.

## 0.9.2

### Patch Changes

- 3d338d5: Show subcommands as `<command>` (required) when the parent command has no `run` handler, and `[command]` (optional) when it does

## 0.9.1

### Patch Changes

- 860dbe2: `skills add` now accepts `install` and `skills remove` accepts `uninstall` as aliases, matching the verbs most package-manager-trained users reach for first. Both spellings dispatch to the same command, so existing invocations continue to work; help output lists the aliases under each command.
- b631ccd: Address Copilot review feedback on `politty/skill`

  - `scanSourceDir` now wraps the source directory's `statSync` in try/catch instead of guarding with `existsSync`. Permission/IO errors (EACCES/EPERM) on the source directory are surfaced as `read-failed` ScanErrors with the original error message, where previously they were silently misclassified as `missing-source`.
  - `assertSafeName` in the installer now also rejects names longer than 64 characters, matching the frontmatter schema's documented 1..64 length constraint. The check stays a deliberately independent (defense-in-depth) duplicate of the schema rather than a shared import.
  - `skills list --json` no longer interleaves scan-error summary lines into stdout. The machine-readable JSON payload stays the only thing on stdout in `--json` mode; per-error stderr warnings still fire so operators can see what was skipped. Previously a malformed source SKILL.md could corrupt the JSON output.
  - `listStatus` now reserves `missing` for dangling canonical symlinks (the only state `removeOwnedSkill`'s cleanup path can actually clean up). A real directory at `.agents/skills/<name>` without a readable SKILL.md is now reported as `unstamped`, which routes it through the no-clobber guard instead of incorrectly promising the slot can be reaped.
  - `installSkill` now refuses up-front when the source path overlaps **any** install destination — the canonical `.agents/skills/<name>` slot or any `SYMLINK_TARGETS` agent slot (e.g. `.claude/skills/<name>`) — in both `mode: "copy"` and `mode: "symlink"`. Previously only copy-mode overlap with the canonical slot was checked: a source sitting at an agent slot survived the canonical check and then got rm-rf'd by `populateAgentDirs`'s own `clearInstallSlot` once the stamp matched, taking the source data with it (and in symlink mode creating a canonical↔agent symlink loop). The copy-mode case where the destination ended up inside the source — recursing until the path/disk limit was hit because the cyclic-symlink detector does not catch it (no symlink involved) — is covered by the same guard.
  - The overlap-guard helper `pathsOverlap` is now boundary-aware: only `..` and `..<sep>...` count as "escaping" the outer path. The previous `startsWith("..")` test misclassified valid same-level siblings whose names happened to start with `..` (e.g. a source at `.agents/skills/<name>/..backup`) as outside, so the guard missed real overlaps and `clearInstallSlot` would have rm-rf'd the canonical slot while the source was nested inside it.
  - `findOwnedInstalledSkills` now distinguishes spec-incompatible legacy names from IO errors when reading an installed skill's ownership. Previously the `try { readInstalledOwnership } catch { continue }` swallowed every throw, so EACCES/EPERM on an installed `SKILL.md` left an unreadable orphan in place while `skills sync` reported success. Names that can't have been produced by this CLI (failing the spec pattern or the 1..64 length) are now filtered out by a local defense-in-depth duplicate of the schema before the call; the catch path is reserved for real IO failures and emits a stderr warning per affected slot.
  - `logScanErrors` now treats `read-failed` errors whose `path === sourceDir` as directory-level failures (matching `scanFailedAtRoot`). A `readdirSync(sourceDir)` failure such as EACCES previously rendered as "Skipping skill at <sourceDir>" with no stdout summary, masking a broken source directory as a single malformed skill.
  - `skills remove` (no-argument path) now branches on `scanFailedAtRoot` before printing its no-op summary, matching `add`/`list`/`sync`. A missing or unreadable `sourceDir` previously rendered as "No skills found in source directory; nothing to remove." — a legitimate-empty-bundle message that contradicted the directory-level warning `loadSkills` already emitted.
  - `removeInstalledSlot` and `clearInstallSlot` now only swallow ENOENT/ENOTDIR from the slot's `lstatSync`; other failures (EACCES/EPERM/IO) propagate. Previously a permissions or IO failure on the slot was silently treated as "nothing to do", so `uninstallSkill` / `installSkill` would report success while leaving the slot intact — and a subsequent install would then fail the no-clobber guard with no actionable context.
  - `findOwnedInstalledSkills` now only treats ENOENT/ENOTDIR on `.agents/skills` as a legitimate "no installed skills" result. Other `readdirSync` failures (EACCES/EPERM/IO) are warned to stderr — previously every throw was swallowed, so a permission failure on the install root made `sync`'s orphan reconciliation and `--exclude` validation silently skip the installed-skill universe, masking a permission problem as success.
  - The no-clobber guard in `installSkill`'s caller (`addSkill`) now uses slot presence + non-dangling-symlink instead of `hasInstalledSkill`, **and** mirrors the route-to-source check used by `cleanupBrokenSlot`/`findOwnedInstalledSkills` when classifying a dangling canonical as reapable. Previously a live symlink at `.agents/skills/<name>` whose target lacks a `SKILL.md` (foreign / partial install) passed the guard (because `hasInstalledSkill` resolves the symlink and finds no file) and was silently unlinked by `clearInstallSlot`, even though `listStatus` already classifies the same state as `unstamped`. The route check additionally protects the dangling case in the shared `.agents/skills/` namespace: a dangling canonical pointing at another politty-based CLI's (now-uninstalled) source dir is no longer treated as "almost certainly ours" — only dangling symlinks that still route into this CLI's `sourceDir` are reaped, matching the rule the other two callers already enforce. The three paths now agree.
  - Re-synced `package-lock.json` with `package.json` so npm-based installs (`npm ci`) can resolve the runtime `yaml` dependency. The lockfile had been left untouched since `yaml` was promoted to a top-level dependency, so anyone installing the package via npm would have ended up without a critical scanner dependency. pnpm-lock.yaml was already in sync.
  - `removeInstalledSlot` and `clearInstallSlot` now refuse to unlink a foreign symlink at an agent-specific slot (`.claude/skills/<name>`). The two functions accept a `restrictSymlinkTo` option that the agent-slot call sites set to the canonical slot, and unlinking proceeds only when the existing symlink routes there. Previously, a symlink another tool installed at the same agent path was silently unlinked: `uninstallSkill` did so during `skills remove`/`sync`, and `populateAgentDirs`'s `clearInstallSlot` did so during `skills add`/`sync`. Stamped canonical slots stay under unconditional ownership (the stamp resolves the ambiguity); the unstamped/dangling cases are handled by the dangling-route guard below.
  - `cleanupBrokenSlot` (the dangling-symlink reaper invoked by `skills remove`/`sync` when our canonical is broken) now applies the same route-to-our-canonical check to each agent-slot symlink before unlinking. Previously the sweep treated any dangling agent-slot symlink with the same skill name as ours; a foreign tool's dangling symlink pointing at its own canonical (in the shared `.claude/skills/<name>` namespace) would have been silently deleted.
  - `cleanupBrokenSlot` and `findOwnedInstalledSkills` now confirm a dangling canonical symlink still routes into this CLI's `sourceDir` before treating it as ours. `.agents/skills/<name>` is a namespace shared by every politty-based CLI (each writes its own ownership stamp); a dangling canonical has no stamp to read, so without the routing check we would silently reap a foreign CLI's stale install during `skills remove`/`sync` (and include it in `--exclude` validation). The lexical containment check resolves the deepest existing ancestor of the (dangling) target through `realpathSync` so it survives macOS `/tmp` → `/private/tmp` remapping, projects mounted via a symlink, and pnpm-style `node_modules` hops. Live canonical symlinks still go through the ownership-stamp path.
  - `removeInstalledSlot` now verifies the canonical-slot symlink's routed-to SKILL.md carries `expectedStamp` before unlinking, matching the route-check that already gates agent-specific slots. Previously a programmatic `uninstallSkill(name, cwd, { expectedOwnership })` would unconditionally unlink a live canonical symlink, so another politty-based CLI's live install in the shared `.agents/skills/<name>` namespace could be deleted. `expectedStamp === null` keeps the legacy permissive behaviour for teardown helpers that opt out of ownership checks.
  - `docs/skill-management.md` no longer claims `skills remove` (no-argument form) cleans up every skill owned by the CLI. The implementation iterates only skills currently discovered in `sourceDir`, so owned orphans (skills the CLI previously installed but no longer ships) survive a bare `remove` — they require `skills sync` or naming them explicitly. The previous wording invited users to expect `remove` to behave like `sync`'s orphan reconciliation.
  - `installSkill` now runs the source-vs-destination overlap guard _before_ `mkdirSync(canonicalParent)` and each `SYMLINK_TARGETS` parent's `mkdirSync`. Previously a failing overlap install (typically a single-skill source rooted at the project directory, so `sourcePath` ⊇ `cwd`) still left freshly-created `.agents/skills/` and `<agent>/skills/` directories inside the source tree before throwing. The pre-check uses a deepest-existing-ancestor + lexical-tail resolution so the comparison still catches `/tmp` ↔ `/private/tmp` realpath remaps when the destination parents don't exist yet.
  - `installSkill` now pre-flights every symlink target's relativity _before_ any `clearInstallSlot` runs. The "absolute target" guard previously lived inside `symlinkOrCopy`, where it only fired after the canonical (or an agent slot) had already been unlinked. On Windows `path.relative` returns an absolute path when the endpoints sit on different drive letters; discovering the absolute target there left the user with no install (the prior owned install was already gone, the new symlink was refused). The pre-flight resolves parents through the same deepest-existing-ancestor helper as the overlap pre-check, so cross-volume sources are surfaced with the "retry with mode: copy" guidance before any state change. The in-line check inside `symlinkOrCopy` is kept as defense-in-depth for programmatic callers that build their own argument set.
  - `listStatus` now scopes `status: "missing"` to dangling canonical symlinks that still route into this CLI's `sourceDir`, matching the cleanup contract enforced by `cleanupBrokenSlot` and `findOwnedInstalledSkills`. A dangling symlink routed to another politty-based CLI's source (the shared `.agents/skills/` namespace) is now reported as `unstamped` instead, so `skills list` no longer promises a `remove`/`sync` sweep that the cleanup path will refuse. Docs updated to reflect the new boundary.
  - Renamed `playground/26-skill-management` to `playground/30-skill-management` so the playground keeps its established unique sequential numbering (`main` already shipped `26-command-alias`).
  - `skills sync` orphan reconciliation now retains owned installs whose source SKILL.md errored this run. Errored source subdirectories (e.g. a transient malformed-frontmatter packaging issue alongside healthy siblings) produced a `ScanError` but no entry in `sourceNames`, so the orphan pass would have rm-rf'd their installs as if the CLI had intentionally dropped them. Errored subdirectories' basenames are now collected from the scan result and treated like `--exclude` entries for the orphan loop, so transient bundle damage no longer silently uninstalls live skills. Root-level scan failures (`scanFailedAtRoot`) still short-circuit the whole orphan pass — the new filter only matters when at least one valid skill keeps cleanup eligible.
  - `cleanupBrokenSlot` now sweeps matching agent-specific slots **before** unlinking the canonical, mirroring the dependency order that `symlinkRoutesTo`'s realpath fallback needs. Previously the canonical was unlinked first; on a project mounted through a symlink the surviving agent-slot symlink's `realpathSync` route check could no longer prove ownership once the canonical was gone, so the matching `.claude/skills/<name>` dangling symlink was left behind. The order swap keeps agent-slot cleanup deterministic regardless of how `cwd` is resolved.
  - `danglingRoutesToSource` now resolves `sourceDir` through the deepest-existing-ancestor helper instead of bailing when `realpathSync(sourceDir)` fails. The `status: "missing"` contract documented in `docs/skill-management.md` covers exactly the case where the source package — and therefore the whole configured `sourceDir` — was uninstalled, but the previous `try/catch` returned `false` in that scenario and left `skills remove <name>` / `skills sync` unable to reap the dangling canonical it was meant to reap. The deepest-existing-prefix fallback keeps the route comparison lexically meaningful even when the directory is absent, matching the same approach already used for the (dangling) target path.
  - `installSkill` now resolves the source path **asymmetrically** when writing the canonical symlink target. Every ancestor symlink (a symlinked checkout, macOS `/tmp` → `/private/tmp`, etc.) gets dereferenced like `realpathSync` would, EXCEPT a `node_modules/<pkg>` (or `node_modules/@scope/<pkg>`) symlink, which is preserved verbatim from that point onward. Previously the source was realpath'd in full, which on pnpm projects baked the volatile `node_modules/.pnpm/<pkg>@<version>_<hash>/node_modules/<pkg>/...` hash path into every install — a subsequent `pnpm update` swapped the hash and left every installed skill dangling. An interim "purely lexical source" approach fixed pnpm but mis-handled a symlinked project checkout: the relative link target then routed back through the shortcut symlink, so a copy/remount of the real project tree would have broken the install. The asymmetric resolver dereferences the project-root portion (so the relative link target stays consistent with the realpath'd install root) while preserving the package-manager hop (so `pnpm update` doesn't strand the install). The overlap guard and copy-mode payload still go through the fully `realpathSync`-resolved source — the guard catches a source-side symlink whose target is nested inside the install root, and the copy payload reads through every symlink so a copy install doesn't leave dangling references back into `node_modules`. The cross-volume `assertRelativeLinkTarget` pre-flight remains correct because cross-drive endpoints are cross-drive lexically as well.
  - Re-exported `SkillFlagOverrides` from the `politty/skill` package entrypoint. The type is part of the public `SkillCommandOptions` surface (`flags?: SkillFlagOverrides`) and is referenced in the API docs, but the package only exposes `./skill`, so consumers wanting to annotate a `flags` override could not import the type directly. The companion types `DiscoveredSkill`, `InstallSkillOptions`, etc. were already exported; this aligns the entrypoint with the documented options surface.
  - `sync`'s orphan-retention guard now protects an install slot at **either** the directory basename or the frontmatter `name` when a source skill emits a `name-mismatch` scan error. `ScanError` carries an optional `skillName` that the scanner populates from the parsed frontmatter for name-mismatch only; the guard now adds both candidates to the protected set. Previously the guard only stored `basename(error.path)`, so if a user renamed the source directory (or the frontmatter name) and the prior install lived under the _other_ name, the orphan pass would silently rm-rf the live install instead of treating the renamed source as a retained (errored) entry.
  - `docs/api-reference.md` now documents the optional `ScanError.skillName` field and lists `SkillFlagOverrides` in the `politty/skill` entrypoint's exported types. Both omissions left the public API reference inconsistent with the actual exports.
  - Re-exported the `ParsedSkillMd` type from the `politty/skill` entrypoint. The type is the named return type of the public `parseSkillMd` function (and is referenced in the API docs), but the package only exposes `./skill`, so consumers wanting to annotate a parsed-SKILL.md result couldn't import the type directly. Docs updated to list the export and inline the shape next to `parseSkillMd`.
  - Documented the copy-mode stamp precondition on `installSkill` across `docs/skill-management.md`, `docs/api-reference.md`, and `SkillCommandOptions`'s `package` JSDoc in `src/skill/types.ts`. The primitive still does not compare ownership, but in `mode: "copy"` it now throws when the source SKILL.md has no `metadata["politty-cli"]` stamp at all (so a second install isn't stranded by the "Refusing to replace non-symlink" guard). The public docs previously claimed the primitive performed no stamp checks of any kind, which would have surprised programmatic callers using copy mode directly.
  - Copy-mode installs now stage the copy at a sibling `<canonical>.partial-XXXXXX` and rename it into place only after the full copy succeeds. A mid-copy failure (unreadable child, cyclic directory symlink, EIO, etc.) used to leave the canonical slot as a real directory — possibly without `SKILL.md` depending on `readdirSync` order — and the next install's `clearInstallSlot` would refuse to replace the stamp-less directory, breaking the documented "re-running converges" idempotency. The staging-and-rename guarantees the canonical slot is either absent or fully populated; the partial sibling is removed on failure (and any sibling surviving a crash is harmless on-disk garbage that future installs ignore).
  - `readStampAt` now only swallows ENOENT/ENOTDIR (a missing SKILL.md, or a broken symlink upstream that surfaces as either) and propagates other read failures (EACCES/EPERM/IO). The function gates `clearInstallSlot`/`removeInstalledSlot`'s destructive branches: a silently-`null` permission failure would either let `uninstallSkill` report success after deleting the canonical slot while leaving an unreadable agent slot behind, or let `clearInstallSlot` throw the misleading "looks like a legacy or manual install" message that points users at the wrong remediation. Symmetric with the ENOENT/ENOTDIR-only carve-out `readInstalledOwnership` already uses for the same reason.

- 7a26f2b: Add `politty/skill` module for managing SKILL.md-based agent skills

  - `withSkillCommand(cli, { sourceDir, package })` wraps a command with `skills sync | add | remove | list` subcommands
  - Frontmatter is validated against the Agent Skills specification (https://agentskills.io/specification): `name` is lowercase-hyphenated, `description` <=1024 chars, `metadata` is a string->string map, and `license`/`compatibility`/`allowed-tools` are accepted. Unknown top-level keys round-trip via `.passthrough()`
  - Installer populates `.agents/skills/<name>` (canonical) and each agent-specific dir (e.g. `.claude/skills/<name>`) from the source; the materialization is controlled by `mode`: `"symlink"` (default — source updates propagate live; throws with guidance to retry with `"copy"` on filesystems without symlink support, e.g. Windows without Developer Mode) or `"copy"` (recursive copy that works anywhere but requires re-running `sync` to propagate updates). Agent-specific slots route through the canonical slot so one `sync` swaps all hops at once
  - Source SKILL.md must pre-declare `metadata["politty-cli"] = "{package}:{cliName}"`; `skills add` / `skills sync` refuse to install a skill whose authored stamp does not match the expected `{package}:{cliName}`, and `remove` / `sync` refuse to delete skills owned by another tool. Copy-mode installs carry the stamp because the source SKILL.md is copied verbatim. The installer never writes to SKILL.md — the stamp is authored at package time, not rewritten at install time
  - `sync` also removes orphans — skills the CLI previously installed but no longer bundles
  - Scanner returns `{ skills, errors }`; invalid SKILL.md files surface as warnings instead of being silently skipped. Symlinked skill dirs and symlinked SKILL.md files are accepted (npm packages already execute arbitrary JS on install, so refusing symlinks here would not raise the trust boundary)
  - `withSkillCommand` throws if the host command already defines a `skills` subcommand

- 0dd20eb: Improve `politty/skill` ergonomics based on usage feedback
  - `skills sync --exclude` now uses `-x` as its short alias instead of `-e`, sidestepping the common collision with CLI-level global flags. Override or disable per CLI via `flags.exclude.alias` (string to rename, `false` to drop the alias entirely).
  - `withSkillCommand` resolves the install root by walking up from `process.cwd()` to the closest `.git/` or `package.json`, falling back to `process.cwd()`. This stops `<sub>/.agents/skills/...` from appearing when the CLI is invoked from a project subdirectory. Override with the new `cwd` option (e.g. the directory of a CLI-specific config file). The programmatic primitives (`installSkill`, `uninstallSkill`, `hasInstalledSkill`, `readInstalledOwnership`) keep their original `process.cwd()` default — find-up only applies inside `withSkillCommand`'s subcommands.
  - `withSkillCommand` appends a one-line skills usage hint to the wrapped command's `description` (separated from the host description by a blank line so `--help` renders it as its own paragraph) so `--help` advertises the skills subcommand. Pass `descriptionAppend: false` to opt out, or a string to override the hint.
  - `skills add` and `skills sync` accept `--verbose` / `-v`, which prints the install path and resolved mode for each installed skill.
  - `skills list` now reports a per-skill `status` (`installed`, `not-installed`, `foreign`, `unstamped`, `missing`, `unreadable`) in both text and JSON output, surfacing common packaging mistakes (e.g. `politty-cli` typos installed under another stamp) without having to hand-inspect `.agents/skills/<name>`.
  - `skills sync`, `skills remove`, and per-skill scan errors now print explicit summary lines on stdout (`No skills installed (all skills excluded).`, `nothing to remove`, `Skipped N skill(s) due to scan errors`) so an empty result is no longer silent in stdout-only pipelines.
  - `skills add` now accepts multiple skill names (`skills add commit review`) and pre-validates every name against the source directory before installing. Any unknown name aborts the run with a single error listing all unknown names — previously `skills add valid nonexistent` silently dropped the typo and exited 0 because only the leading positional was bound.
  - `skills sync --exclude` now aborts with an error when an exclude value matches neither a source skill nor an already-installed owned skill (e.g. typos like `--exclude nonexistent`). Every unknown name is listed in a single error so the whole invocation can be fixed in one round-trip, mirroring `skills add`'s unknown-name handling — previously the typo was a silent no-op. Installed orphans (skills this CLI used to ship and you want sync to leave in place) remain a legitimate exclude target.
  - Documented symlink target convention (relative, realpath-resolved), atomicity (per-call non-transactional, multi-skill fail-fast, idempotent on re-run), and the Windows / no-symlink-filesystem fallback to `mode: "copy"` in `docs/skill-management.md` and the `installSkill` JSDoc.
  - `installSkill` now creates each symlink at the realpath-resolved parent directory, matching the realpath-resolved relative target so `linkPath` and `linkTarget` share the same prefix style. Previously the link was written at the un-resolved parent while the target was computed from the resolved one — an asymmetry that POSIX kernels happen to resolve correctly but that drifts from the code's stated intent on filesystems with logical-`..` semantics.
  - `installSkill` now refuses to write an absolute symlink target and throws with guidance to retry with `mode: "copy"`. This guards the documented "relative target" contract on Windows where `path.relative()` falls back to an absolute path when the source and install root straddle different drive letters.
  - `parseFrontmatter` now surfaces YAML parse errors via a new `parseError` field, and `scanSourceDir` includes that message in the `parse-failed` ScanError. A malformed frontmatter fence used to surface as a downstream "name: Required" Zod error; now the actual YAML cause is reported, which is what the user needs to fix.
  - `scanSourceDir` no longer swallows `statSync` errors on individual source entries. EACCES / EPERM / IO failures on a single entry are now surfaced as `read-failed` ScanErrors so one unreadable subdirectory does not hide silently. ENOENT on a non-symlink entry is still skipped (a racing remove between `readdir` and `stat`), but ENOENT on a symlink entry is reported as a dangling-symlink `read-failed` error so a stale monorepo path doesn't disappear from the scan without a trace. Likewise, IO failures from the `SKILL.md` presence check (previously swallowed as "absent") now propagate as `read-failed` rather than letting an unreadable candidate silently vanish.
  - `skills sync` now emits a distinct stdout summary when the source directory itself failed to scan (`No skills installed (source directory scan failed; see warnings).`), so a stdout-only pipeline can tell apart a legitimate empty bundle from a misconfigured source path. `logScanErrors` mirrors this on stdout with a one-line "Source directory scan failed" notice when any directory-level error is collected.
  - `SYMLINK_TARGETS` is now exported from `installer.ts` and consumed by `commands.ts`'s dangling-symlink reaper, removing the previous comment-synced duplicate `AGENT_SLOT_DIRS` so the slot enumeration has a single source of truth.
  - `skills add`, `skills sync --exclude`, and `skills remove` typo diagnostics now spell out the universe of skill names the user could have meant. Each command lists only the names its argument actually accepts: `add` shows `Source: …`, `remove` shows `Installed: …`, `sync --exclude` shows both. Previously `--exclude`'s error told the user "not found in source or installed" without ever showing the installed list, and `remove`'s no-op message offered no recovery hint at all.
  - `skills add` and `skills list` now mirror `sync`'s scan-failure handling: when the source directory scan fails at the directory level they emit a distinct stdout summary (`No skills installed (source directory scan failed; see warnings).` / `Source directory scan failed; see warnings.`) instead of the misleading "No skills found in source directory.", which previously made a configuration error look like a legitimately empty bundle.
  - `skills list` adds a sixth `status`, `unreadable`, for slots whose `SKILL.md` is present but fails to read (EACCES / EPERM / IO). Previously these were silently rolled into `unstamped`, which conflates "the file has no stamp" with "the file can't be opened". A warning is also logged so the user can act on the underlying cause.
  - `installSkill` now refuses up-front when `mode: "copy"` is requested and the source SKILL.md lacks a `metadata["politty-cli"]` stamp. Without a stamp on the source, `clearInstallSlot` can never match its `expectedStamp` on a re-install, so the first install would succeed and every subsequent one threw "Refusing to replace non-symlink…" with no actionable hint. The new error names the missing field and points to the fix.

## 0.9.0

### Minor Changes

- b7c8ebc: Reduced installation size (2.9MB to approx. 630KB, approx. 78% reduction)
  - Excluded source maps (.map) from the distribution
  - Explicitly excluded build artifacts such as build cache (tsconfig.tsbuildinfo) using the files field
  - BREAKING: Discontinued CJS distribution and changed to ESM-only (loading via require() is no longer possible, removed .cjs and index.d.cts)

### Patch Changes

- dfd1241: Removed the `string-width` runtime dependency
  - Replaced it with a lightweight built-in implementation (using Node's `stripVTControlCharacters` for ANSI stripping) used by the Markdown renderer
  - `politty` now has zero runtime dependencies

## 0.8.0

### Minor Changes

- 16b8503: Make `files`-mode documentation fully generated (marker-free) by default and resolve template links by specificity.
  - **Fully generated `files` output by default (breaking).** `files`-mode generation no longer emits `<!-- politty:...:start/end -->` markers; each file is regenerated as a whole. With `targetCommands`, only files containing a target command are processed, but each is rebuilt in full. Set the new `customizable: true` option on `GenerateDocConfig` when you want to hand-edit the output and have politty preserve your edits via markers (in-place section updates). When `customizable` is set, a command whose generated output gains a section the file lacks is reported as a non-fatal warning (run with `POLITTY_DOCS_DOCTOR=true POLITTY_DOCS_UPDATE=true` to insert it, or leave it removed to opt the section out). `path`/`rootDoc` output still uses markers; `templates` remain marker-free.
  - **Specificity-based link resolution.** Cross-output links now point at the output that renders a command most specifically — a dedicated per-command page (`{{politty:command:config}}`) wins over a full-tree page (`{{politty:command}}`) for that command and its descendants, regardless of registration order.
  - Adds a `markerless` option to `DefaultRendererOptions`.

### Patch Changes

- eea3f6a: Add template-based documentation generation. A new `templates` option on `GenerateDocConfig` maps output paths to template files containing `{{politty:...}}` placeholders; the output is fully generated from the template and contains no politty markers. Templates can exclude specific placeholders with `politty.exclude` front matter.

## 0.7.0

### Minor Changes

- fc88d86: Add `onUnknownSubcommand` option to `runMain` for CLI plugin dispatch.

  When a positional argument is not a known subcommand at any level whose command exposes subcommands, the handler is invoked with the command path traversed so far (`commandPath`), the unknown name, and the args that follow it. Returning a number treats the command as handled and exits with that code; returning `undefined` falls back to the default unknown-subcommand/help behavior. This enables `gh`-style external plugin binaries at the root (`mycli foo` → `mycli-foo`) and nested under known subcommands (`mycli foo bar` → `mycli-foo-bar`). The handler is skipped for internal (`__*`) completion invocations.

  Also exports the `UnknownSubcommandHandler` type.

## 0.6.0

### Minor Changes

- 7167924: Add runtime dispatcher shell completion with fast static-worker paths.

  The default `completion <shell>` output now resolves the active CLI executable at completion time and uses bundled or cached static workers for fast bash, zsh, and fish completions. This keeps project-local binaries working with tools such as `direnv`, `mise`, and `node_modules/.bin`, while avoiding a JavaScript process on common warm completion paths.

  Politty-based CLIs can generate bundled workers with `generateBundledCompletionWorker()` from `politty/completion` or the `politty generate-worker` package-script CLI.

  Existing users:

  - Existing `eval "$(mycli completion bash)"` and `eval "$(mycli completion zsh)"` setup keeps working and now uses dispatcher mode by default.
  - Existing fish users can rerun `mycli completion fish --install` after upgrading to refresh the fish autoload file.
  - If you saved a generated static completion script and want the new dispatcher behavior, regenerate it with `mycli completion <shell>`.
  - If you prefer the previous command-tree script that does not resolve the active binary at TAB time, use `mycli completion <shell> --static`.

  New users:

  - Use `mycli completion bash`, `mycli completion zsh`, or `mycli completion fish --install` for the default dispatcher setup.
  - For published CLIs, generate and ship a bundled worker artifact with `politty generate-worker --bin dist/cli/index.mjs --program mycli --shell zsh --verify` to avoid first-TAB worker generation.
  - For package layouts that cannot be represented with package-relative worker paths, enable `bundledWorker.queryCommand` so the dispatcher can ask the CLI for `__completion-worker-path <shell>` on the miss path.

## 0.5.1

### Patch Changes

- 6c1a89e: Make generated shell completion scripts self-refresh when saved to disk. Existing eval-based setup keeps working, while static bash/zsh/fish completion files generated by this release can refresh themselves after the CLI binary changes.

## 0.5.0

### Minor Changes

- dc1afef: Add `completion.custom.resolve` for in-process JS dynamic completion. The resolver receives a `DynamicCompletionContext` (current word, shell, other parsed arg values, previously supplied values) and returns candidates synchronously or via Promise. Static shell scripts (bash/zsh/fish) now delegate to `<program> __complete --shell <shell>` whenever a field uses `resolve`; the generated bash delegate stays compatible with Bash 3.2. Specifying more than one of `choices`, `shellCommand`, `resolve`, or `expand` on the same field throws.

  Type-level note: `generateCandidates(context, { shell })` now returns `Promise<CandidateResult>` and takes a required second argument. `__complete`'s internal `run` is async. Callers using only the high-level `withCompletionCommand` flow are unaffected.

### Patch Changes

- bbbad4f: Add `completion.custom.expand` for value completion that is pre-enumerated at script-generation time and baked into the static shell script. The user supplies `dependsOn` (sibling arg names that must have static `choices` or an enum schema) and `enumerate(deps)`; politty walks the cartesian product of the dependsOn values, calls `enumerate` for each combination, and emits Bash 3.2-compatible scalar variables, a hoisted associative array (zsh), or an inline switch (fish) keyed on those values. No Node process is spawned at TAB time — the shell dispatches via a case lookup or indirect-expansion lookup, taking the same `<10ms` path as static `choices`. Specifying more than one of `choices`, `shellCommand`, `resolve`, or `expand` on the same field throws.

## 0.4.16

### Patch Changes

- 6f75710: Add auto-refresh for shell completion caches.

  Generated bash/zsh/fish scripts now embed a `# politty-bin-sig: <mtime>` header. The cache is regenerated automatically through two complementary paths:

  - A small rc-loader snippet (printed by `<program> completion <shell> --loader`) that bash/zsh source on every shell startup. It compares the binary's mtime against the cache header and rewrites the cache when they differ before sourcing it.
  - A detached `__refresh-completion` child that `runMain` spawns on every CLI invocation, keeping caches warm even when shells aren't restarted.

  For fish, the autoload file written by `<program> completion fish --install` ends with a self-rewriting block that runs on TAB and replaces itself when stale.

  New `--install` and `--loader` flags on the `completion` subcommand. New `WithCompletionOptions.cacheDir` and `WithCompletionOptions.programVersion`. Set `POLITTY_NO_COMPLETION_REFRESH=1` to disable the runMain background hook.

- 83ca319: Add a `negation` option for boolean fields. Set it to a string (e.g. `"disable-cache"`) to replace the default `--no-<name>` form with a custom name, to `true` to keep the default `--no-<name>` and advertise it in help/docs/completions, or to `false` to disable negation entirely (both the default `--no-*` and any custom name are rejected). An optional `negationDescription` renders a separate row in help and generated docs. Help output, generated documentation, and shell completions (bash/zsh/fish) all reflect the configuration. Non-boolean fields are rejected at the type level and at runtime.
- 98de327: Fix Windows path separators leaking into generated docs:

  - Cross-file Markdown links now use forward slashes (`commands/config.md#config`) instead of `commands\config.md`, so links render correctly on every Markdown renderer.
  - Index marker scopes embedded in `rootDoc` files (`<!-- politty:index:<path>:start -->`) are normalized too, so docs generated on Windows can be regenerated on macOS/Linux without silently skipping the index update.

- 5a10050: Fix typecheck failure under `@typescript/native-preview` ≥ 20260504.

  Zod's registry rewrites the meta type through `$replace<Meta, S>`, and newer TypeScript builds expand the generic `then` signature on `PromiseLike<void>` inside `effect`'s return type during that rewrite, producing a structural type that is no longer assignable to the original `ArgMeta`. The runtime value is unchanged, so `getArgMeta` now restores the static type at the boundary with a localized cast.

## 0.4.15

### Patch Changes

- 161151d: Add command alias support for subcommands. Commands can now define `aliases` in `defineCommand()` to allow invocation by alternative names. Aliases are displayed in help output, documentation, and shell completions, with validation to prevent conflicts.

## 0.4.14

### Patch Changes

- dbd71fe: Extend `alias` to accept `string | string[]`. Multi-character entries
  become additional long options (e.g. `alias: "to-be"` accepts both
  `--tobe` and `--to-be`), and arrays allow combining short and long
  aliases (`alias: ["v", "loud"]`). Kebab-case long aliases also accept
  their camelCase variant.

  Add `hiddenAlias` (same shape as `alias`) for names the parser should
  accept without surfacing them in help, generated docs, or shell
  completion — useful for legacy or deprecated option names.

## 0.4.13

### Patch Changes

- caa32e4: Add `politty/prompt` module for interactive missing-option prompts with TTY detection, discriminatedUnion support, and pluggable adapter interface. Ships with two adapters: `politty/prompt/clack` (@clack/prompts) and `politty/prompt/inquirer` (@inquirer/prompts).
- 1db0f98: Switch CI runner from ubuntu-slim to ubuntu-latest to fix knip memory allocation failure with oxc-parser
- 200ac28: Use FileConfig.title and description in deriveIndexFromFiles for index category generation
- 34ad15e: Use oxfmt JavaScript API instead of CLI subprocess for formatting in tests

## 0.4.12

### Patch Changes

- 2f5afbf: Add POLITTY_DOCS_DOCTOR mode to detect and insert missing section markers in existing documentation files

  Fix duplicate validation error display: remove direct error logging from runCommandInternal (programmatic API) and add displayErrors option to runMain for controlling error output

## 0.4.11

### Patch Changes

- bae8af4: Show description for empty xor variants in help output and generated docs instead of silently skipping them

## 0.4.10

### Patch Changes

- b908f86: Add dual-case (camelCase/kebab-case) access for command args in both types and runtime
- c2cecc3: Clear stale section marker content when generated output no longer includes the section (e.g., options emptied by globalArgs filtering). In check mode, stale markers are now reported as diffs, which may cause CI to fail if markers are out of sync.

## 0.4.9

### Patch Changes

- 5406787: Automatically clean up orphaned section markers for deleted commands in update mode. Wrap global options link with section marker so it is not silently dropped in section-level marker mode.

## 0.4.8

### Patch Changes

- 93d6618: Add `effect` callback to `arg()` metadata for executing side effects after argument parsing and validation. The effect `value` parameter is type-safe via Zod schema output type, and `EffectContext.globalArgs` provides typed access to global args (via declaration merging) in command arg effects.
- 6a07e83: Fix transform (pipe) schemas breaking flag detection by using correct Zod v4 `def.in` property and handling pipe type in `extractFields`

## 0.4.7

### Patch Changes

- ca62fe5: add global setup/cleanup hooks to runMain and runCommand options

## 0.4.6

### Patch Changes

- e3e5936: Support bidirectional camelCase/kebab-case CLI argument resolution. Fields defined in either case now accept CLI input in both formats. Also adds `--noCamelCase` and `--no-kebab-case` boolean negation and blocks the mixed `--no-camelCase` form. Includes collision-safe alias registration and `definedNames` guard that prevents field names starting with "no" from being misinterpreted as boolean negation.
- 14ed3c8: Add variant-aware markdown rendering for union, xor, and discriminatedUnion schemas in doc generation

## 0.4.5

### Patch Changes

- 00df8e4: Add runtime global options and documentation enhancements
  - Add `globalArgs` option to `runMain`/`runCommand` for runtime global options shared across all subcommands
  - Add `createDefineCommand<TGlobalArgs>()` factory and `GlobalArgs` interface for type-safe global args access
  - Add subcommand scanner to recognize global flags before/after subcommand position
  - Add `Global Options:` section and `[global options]` usage line to help output
  - Propagate global options to all subcommand levels in shell completion scripts
  - Add `PathConfig` API as a simpler alternative to `files` for documentation output configuration
  - Add `RootCommandInfo` for root document customization (title, description, header, footer)
  - Auto-generate global options anchor and cross-file links in documentation
  - Auto-derive `rootDoc.globalOptions` from `globalArgs` schema in `generateDoc`
  - Validate global schema: reject duplicates, positional fields, and reserved aliases (`-h`/`-H`)
  - Handle global/local flag collision (local takes precedence)

## 0.4.4

### Patch Changes

- 0799021: Fix new subcommand insertion position in targetCommands mode. Previously, auto-expanded subcommands were appended to the end of the file instead of being inserted at the correct alphabetical position among siblings.

## 0.4.3

### Patch Changes

- 2082857: Fix stdout truncation when piped (e.g., `eval "$(cli completion zsh)"`)

  Drain stdout buffer before calling `process.exit()` in `runMain`. When stdout is a pipe, Node.js buffers writes asynchronously. Without draining, large outputs (such as shell completion scripts) could be truncated, causing shell syntax errors like `zsh: unmatched "`.

## 0.4.2

### Patch Changes

- f2145f2: feat(completion): add `matcher` glob pattern support for file filtering (e.g., `.env.*`)

## 0.4.1

### Patch Changes

- 763a1d9: Refactor shell completion to thin shell wrappers with `__complete` delegation and fix extension filtering
  - Refactor shell scripts (bash/zsh/fish) to thin wrappers that delegate to `__complete --shell={shell}`
  - Resolve shellCommand execution and file extension filtering in JS via `@ext:` metadata protocol
  - Fix zsh `_files -g` fallback showing all files when no extensions match (file-patterns zstyle)
  - Fix bash inline `--opt=value` completion, glob expansion, and stale COMPREPLY
  - Fix fish prefix completion bug (`commandline -ct` not always included)
  - Add `NoFileCompletion` directive for enum/choices value completions
  - Add comprehensive shell completion E2E tests across bash/zsh/fish (zpty, expect, complete --do-complete)
  - Split shell completion tests into per-shell vitest projects with CI matrix parallelization
  - Add shell completion guide documentation (`docs/shell-completion.md`)

## 0.4.0

### Minor Changes

- 73aa8c2: Replace command-level markers with section-level markers

  Markers have changed from `<!-- politty:command:<path>:start/end -->` to per-section markers like `<!-- politty:command:<scope>:heading:start/end -->`, `<!-- politty:command:<scope>:description:start/end -->`, etc.

  Index markers now include a scope parameter: `<!-- politty:index:<scope>:start/end -->`.

  This enables users to selectively customize individual sections (heading, description, usage, arguments, options, subcommands, examples, notes) by removing their markers, while keeping other sections auto-generated.

## 0.3.3

### Patch Changes

- eab1560: Fix table alignment in Markdown renderer when cells contain inline formatting (backticks, bold, italic) or full-width characters. Column widths are now calculated based on visual width using string-width instead of string length.

## 0.3.2

### Patch Changes

- eb25582: Add dynamic shell completion via `__complete` command
  - Add `__complete` command that outputs completion candidates at runtime
  - Support dynamic completion mode with `--dynamic` flag in completion command
  - Auto-include `__complete` in `withCompletionCommand()` by default
  - Add context-aware completion parsing for subcommands, options, and positional arguments
  - Support completion directives for file/directory completion

## 0.3.1

### Patch Changes

- 582600a: Add globalOptions and index marker support for documentation generation

## 0.3.0

### Minor Changes

- 7289e4d: Make `programName` parameter optional in `createCompletionCommand` and `withCompletionCommand`, defaulting to `rootCommand.name`

## 0.2.2

### Patch Changes

- b08beb5: Add markdown table syntax support to the terminal markdown renderer

## 0.2.1

### Patch Changes

- f447c8d: Add lightweight markdown renderer for styled terminal help notes with support for headings, lists, code blocks, blockquotes, and GitHub alert syntax
- 92f3dc3: Show required/optional status in options documentation output

## 0.2.0

### Minor Changes

- ac11f29: Auto-prepend full command path in documentation examples via `commandPrefix` option in `ExamplesRenderOptions`

### Patch Changes

- 11fa620: Fix zsh completion error when loading via eval by using compdef instead of direct function call

## 0.1.2

### Patch Changes

- 1d0fc53: Add `renderArgsTable` and `renderCommandIndex` functions for documentation generation.
  - `renderArgsTable`: Render args definitions (like `commonArgs`) as markdown options table
  - `renderCommandIndex`: Generate categorized command index tables with links to documentation

## 0.1.1

### Patch Changes

- 70d35f1: Export `parseArgv` function and related types (`ParsedArgv`, `ParserOptions`) from the main entry point.

## 0.1.0

### Minor Changes

- b4d3be6: Initial release of politty - A type-safe CLI framework built on Zod.

  Features:

  - Type-safe argument parsing with Zod schemas
  - Positional arguments and named options (flags)
  - Subcommands with infinite nesting and lazy loading
  - Lifecycle hooks (setup, run, cleanup)
  - Automatic help generation
  - Environment variable support
  - Discriminated union for mutually exclusive options
