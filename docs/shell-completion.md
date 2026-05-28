# Shell Completion

politty provides automatic shell completion for bash, zsh, and fish. Subcommands, options, and argument values are all completed dynamically.

For quick setup, see the [README](../README.md#shell-completion). For type signatures and low-level APIs, see the [API Reference](./api-reference.md#shell-completion).

## How It Works

`withCompletionCommand` adds three subcommands to your CLI:

- **`completion <shell>`** — Generates a shell script that users source in their shell config. With `--install`, writes it to its on-disk cache (bash/zsh) or autoload location (fish). With `--loader`, prints the rc-loader snippet (bash/zsh only).
- **`__complete`** (hidden) — The dynamic completion engine used by `completion.custom.resolve`
- **`__refresh-completion <shell>`** (hidden) — Re-installs the on-disk cache when the binary's mtime changes. Used by the rc loader and the runMain background hook.

The generated shell scripts embed static metadata for subcommands, options,
`choices`, file/directory completion, and `expand` tables. These paths stay
inside the shell at TAB time.

When a field uses `completion.custom.resolve`, the generated script delegates
that value completion to the hidden command:

```
mycli __complete --shell bash -- <partial-tokens>
```

That command runs in JavaScript: it parses the partial command line, calls the
resolver, and returns candidates with directives that tell the shell how to
present them.

Command aliases defined via `aliases` in `defineCommand()` are automatically included in both static completion scripts and dynamic completion candidates.

## Auto-refresh

When the CLI binary is upgraded, the cached completion script becomes stale — for example, a renamed subcommand will no longer auto-complete. politty refreshes the cache automatically through two complementary paths:

1. **rc loader** (bash/zsh) — A small snippet in `~/.bashrc` / `~/.zshrc` checks the binary's mtime against the cache header on every shell startup; if they don't match, the cache is regenerated before being sourced. This guarantees the very next shell sees a correct cache.
2. **runMain background hook** — Every time the CLI runs (except when handling `__complete` / `__refresh-completion` / `completion` itself), `runMain` spawns a detached `__refresh-completion <shell>` child. The child does the same mtime-vs-header comparison and rewrites the cache only when stale. This keeps the cache warm even for users who never restart their shell.

For fish, there's no rc loader. Instead, the autoload file written by `<program> completion fish --install` ends with a self-rewriting block that runs on every TAB press and replaces itself in place when the binary's mtime changes.

All paths are best-effort: any I/O failure is silently swallowed because a stale or missing completion is preferable to a broken shell.

### Setup

```bash
# Bash / zsh: install the cache once, then add the loader to your rc file.
mycli completion bash --install
mycli completion bash --loader >> ~/.bashrc   # or ~/.zshrc with `zsh`

# Fish: just install the autoload file. Fish picks it up automatically.
mycli completion fish --install
```

### Cache location

By default the cache lives at `${XDG_CACHE_HOME:-$HOME/.cache}/<program>/completion.<shell>`. You can hardcode an alternate location at wrap-time:

```typescript
const main = withCompletionCommand(rootCommand, {
  programName: "mycli",
  cacheDir: "/opt/mycli/cache", // overrides the XDG default in both the loader and refresh paths
});
```

For fish, the autoload file always lives at `${XDG_CONFIG_HOME:-$HOME/.config}/fish/completions/<program>.fish` since fish dictates that path.

### Header format

Every generated script starts with a small machine-readable header:

```
# politty-completion-version: 1
# politty-bin-sig: 1730000000
# program: mycli
# program-version: 1.2.3
# shell: bash
```

`politty-bin-sig` is the binary's mtime in seconds. The rc loader and `__refresh-completion` compare this against the live binary to decide whether to rewrite the cache. `program-version` is included only when you pass `programVersion` to `withCompletionCommand`.

### Disabling auto-refresh

Set `POLITTY_NO_COMPLETION_REFRESH=1` in your environment to disable the runMain background hook. The rc loader (bash/zsh) is unaffected by this variable; remove it from your rc file if you want to disable the loader path too.

## Completion Types

### Enum (Auto-detected)

Values from `z.enum()` are automatically used for completion. No extra configuration needed.

```typescript
format: arg(z.enum(["json", "yaml", "xml"]), {
  description: "Output format",
});
```

This works for both options (`--format json`) and positional arguments.

### Custom Choices

For values not defined in the schema, provide an explicit list:

```typescript
env: arg(z.string(), {
  completion: {
    custom: { choices: ["development", "staging", "production"] },
  },
});
```

### Shell Command

Run an arbitrary command at TAB time. Results are split by newline.

```typescript
branch: arg(z.string().optional(), {
  completion: {
    custom: { shellCommand: "git branch --format='%(refname:short)'" },
  },
});
```

The command has a 5-second timeout. If it fails or times out, no candidates are shown (stderr is suppressed).

### Resolve (in-process JS)

Compute candidates in the same process from a TS callback that has access to **other arg values typed so far**. Useful when completion depends on prior context — e.g. fields valid for the chosen endpoint, or columns in the chosen table.

```typescript
field: arg(z.array(z.string()).default([]), {
  alias: "f",
  completion: {
    custom: {
      resolve: ({ parsedArgs, previousValues }) => {
        const endpoint = parsedArgs.endpoint as string | undefined;
        if (!endpoint) return { candidates: [] };
        const all = lookupFieldsFor(endpoint);
        // De-dup keys already supplied via earlier `--field key=value` flags.
        const used = new Set(previousValues.map((v) => v.split("=")[0]));
        return { candidates: all.filter((k) => !used.has(k)) };
      },
    },
  },
});
```

The callback receives a `DynamicCompletionContext`:

| Field            | Description                                                                                                                                                                                                                                    |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `currentWord`    | Word being completed. Inline `--field=` prefix is stripped before this is set.                                                                                                                                                                 |
| `shell`          | `"bash" \| "zsh" \| "fish"` — useful when output should differ between shells.                                                                                                                                                                 |
| `parsedArgs`     | Best-effort parsed values of OTHER args on the same command, keyed by camelCase name. Includes positionals (string, or string[] for variadic) and options (string for scalars, string[] for array options). Zod validation is **NOT** applied. |
| `previousValues` | Values already supplied for the option/positional being completed (for de-duping array options).                                                                                                                                               |
| `subcommandPath` | Subcommand path leading here, e.g. `["api"]`.                                                                                                                                                                                                  |

Return `{ candidates, directive? }` where `candidates` is an array of strings or `{ value, description }` objects. When `directive` is omitted it defaults to `FilterPrefix | NoFileCompletion` (matches `choices` behaviour).

The resolver runs **inside the `__complete` command**, so:

- Static shell scripts delegate to `<program> __complete --shell <shell>` whenever a field uses `resolve`. This is automatic — call `withCompletionCommand` and politty wires it up.
- The resolver may be async (returning `Promise<DynamicCompletionResult>`).
- If the resolver throws, completion silently returns no candidates (with `CompletionDirective.Error` set).
- Dot-notation key descent (`labels.foo.bar`) and oneof exclusivity are the resolver's responsibility — politty just passes `currentWord` through and strips the `--field=` inline prefix.
- `console.log` from inside the resolver pollutes the candidate stream; use `console.error` or a logger that writes to stderr instead.

For local dev, set `MYCLI_BIN` (uppercase program name) to override the binary the static script invokes — useful when the CLI hasn't been installed on PATH yet.

### Expand (pre-enumerated)

When all of the candidates can be computed up front from a small, known set
of sibling arg values, use `expand` instead of `resolve`. politty walks the
cartesian product of the `dependsOn` values at script-generation time, calls
`enumerate(deps)` once per combination, and bakes the resulting table into
the shell script. At TAB time the shell dispatches via a case lookup keyed
on the runtime values of those args — **no Node process is spawned**, so
the latency matches static `choices` (typically <10ms).

```typescript
field: arg(z.array(z.string()).default([]), {
  alias: "f",
  completion: {
    custom: {
      expand: {
        dependsOn: ["endpoint"],
        enumerate: ({ endpoint }) => {
          return getFieldsFor(endpoint).map((k) => ({
            value: `${k}=`,
            description: `Set ${k}`,
          }));
        },
      },
    },
  },
});
```

Requirements:

- Every name in `dependsOn` must be a **sibling arg on the same command**
  with a static value set (an explicit `completion.custom.choices` or an
  enum schema). Chaining `expand` specs is not supported.
- `enumerate` must be a pure function of `deps`. politty calls it once per
  combination at the time the user runs `<program> completion <shell>`. If
  it throws, the error is wrapped with the offending field name and the
  `deps` snapshot.
- Mixing `expand` with `choices`, `shellCommand`, or `resolve` on the same
  field throws at command-definition time.
- For multi-dimensional `dependsOn`, the runtime lookup key is the
  concatenation of dep values joined by U+001F. Avoid sibling choices that
  contain that byte (none in practice).

Use this whenever the dependency graph collapses cleanly to a finite,
build-time-known set. Reach for `resolve` when the candidates depend on
process-local state the shell cannot observe (filesystem reads, network
calls, parsing the schema-of-the-day, etc.).

#### Array option deduplication (`-f key=value` repeats)

When `expand` is attached to a repeatable **array option** (`z.array(...)`),
the generated shell script automatically drops any candidate whose `key=`
prefix has already been consumed on the same command line. That is, for the
example above:

```
$ mycli api GetApplication -f workspaceId=foo -f <TAB>
applicationName=    # workspaceId= is filtered out
```

The dedup logic:

- Splits both the user-typed value and each candidate on the first `=`
  and treats everything to the left of `=` as the slot key. There is no
  configurable delimiter — `key=value` is the assumed shape.
- Only fires for option fields with `valueType === "array"`. Scalar
  options and positionals are not deduped (repeating them has different
  semantics).
- Candidates that contain no `=` pass through untouched (e.g. plain enum
  values used as a repeatable list keep duplicating, since they don't
  carry a slot key).

If your CLI uses a different separator (e.g. `key:value`), this dedup
won't engage — the candidates are still emitted correctly, you just
won't get the automatic filtering.

### File Completion

Delegate to the shell's native file completion. Optionally filter by extension:

```typescript
// All files
input: arg(z.string(), {
  completion: { type: "file" },
});

// Only .json and .yaml files (directories are always shown for navigation)
config: arg(z.string(), {
  completion: { type: "file", extensions: ["json", "yaml"] },
});
```

Extensions are specified without a leading dot (`"json"`, not `".json"`).

### Directory Completion

Complete only directories:

```typescript
output: arg(z.string(), {
  completion: { type: "directory" },
});
```

### No Completion

Explicitly suppress the default file completion fallback:

```typescript
token: arg(z.string(), {
  completion: { type: "none" },
});
```

This is useful for secrets or tokens where file suggestions would be noise.

### Resolution Priority

When multiple sources could provide completion values, the following priority applies:

1. **Explicit `custom`** — exactly one of `expand`, `resolve`, `choices`, or `shellCommand`. Specifying more than one throws at command-definition time.
2. **Explicit `type`** — `file`, `directory`, or `none`
3. **Auto-detected** — enum values from `z.enum()`

## Positional Arguments

Completion works for positional arguments, not just options.

**Single positional** with enum:

```typescript
suite: arg(z.enum(["unit", "integration", "e2e"]).optional(), {
  positional: true,
});
```

**Multiple positionals** with different value sets:

```typescript
source: arg(z.enum(["local", "staging", "production"]), {
  positional: true,
  description: "Source environment",
}),
target: arg(z.enum(["dev", "qa", "prod"]), {
  positional: true,
  description: "Target environment",
}),
```

Each positional gets its own completion candidates based on position.

**Variadic (array) positional**:

```typescript
tags: arg(z.array(z.enum(["stable", "beta", "nightly", "rc"])), {
  positional: true,
});
```

Completion continues for each additional value.

## Shell-Specific Notes

### Bash

```bash
# Option 1: Source directly (add to ~/.bashrc)
eval "$(mycli completion bash)"

# Option 2: Save to file (persistent)
mycli completion bash > ~/.local/share/bash-completion/completions/mycli
```

Reload with `source ~/.bashrc`.

The generated bash script runs on **Bash 3.2 or newer**, including the
default `/bin/bash` shipped with macOS. The completion machinery (both
`completion.custom.expand` and `completion.custom.resolve`) avoids
bash 4 builtins — associative arrays are replaced with prefix-scalar
variables, and `mapfile` is replaced with a portable `while read` loop.

### Zsh

```bash
# Option 1: Source directly (add to ~/.zshrc, before compinit)
eval "$(mycli completion zsh)"

# Option 2: Save to fpath directory (note the _ prefix)
mycli completion zsh > ~/.zsh/completions/_mycli
```

If using Option 2, ensure your fpath is configured:

```bash
fpath=(~/.zsh/completions $fpath)
autoload -Uz compinit && compinit
```

Reload with `source ~/.zshrc`.

### Fish

```bash
# Option 1: Source directly
mycli completion fish | source

# Option 2: Save to completions directory (auto-loaded)
mycli completion fish > ~/.config/fish/completions/mycli.fish
```

Fish loads completions from `~/.config/fish/completions/` automatically in new sessions.

## Troubleshooting

**Completions not appearing after setup**

Reload your shell or start a new session. Verify the binary is in PATH with `which mycli`. Test the completion engine directly:

```bash
mycli __complete --shell bash -- ""
```

If this prints subcommand names, the engine is working and the issue is in your shell configuration.

**"command not found" during TAB in development**

The shell script calls your CLI binary by name. During development with `tsx`, create a wrapper script:

```bash
#!/bin/bash
exec npx tsx ./src/cli.ts "$@"
```

See `playground/24-shell-completion/try-completion.sh` for a working example.

**File extension filter not working**

Use bare extension names without a leading dot: `extensions: ["json"]`, not `extensions: [".json"]`. Directories are always shown regardless of the filter to allow navigation into subdirectories.

**Shell command completion returns nothing**

Verify the command works in isolation (e.g., `git branch --format='%(refname:short)'`). Commands have a 5-second timeout and stderr is suppressed, so check that the command produces output on stdout within the time limit.

## Testing Completions

You can test the completion engine directly from the terminal without pressing TAB:

```bash
# Subcommand completions
mycli __complete --shell bash -- ""

# Option completions for a subcommand
mycli __complete --shell bash -- build --

# Value completions for an option
mycli __complete --shell bash -- build --format ""

# Positional completions
mycli __complete --shell bash -- test ""
```

The output format is one candidate per line, with the last line being a directive (`:N`). Common directives:

- `:4` — Filter candidates by the prefix the user has typed
- `:16` — Merge with native file completion
- `:32` — Merge with native directory completion
- `:2` — Suppress file completion fallback

For interactive testing, see `playground/24-shell-completion/try-completion.sh` and `try-completion.fish`.
