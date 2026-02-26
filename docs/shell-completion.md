# Shell Completion

politty provides automatic shell completion for bash, zsh, and fish. Subcommands, options, and argument values are all completed dynamically.

For quick setup, see the [README](../README.md#shell-completion). For type signatures and low-level APIs, see the [API Reference](./api-reference.md#shell-completion).

## How It Works

`withCompletionCommand` adds two subcommands to your CLI:

- **`completion <shell>`** — Generates a shell script that users source in their shell config
- **`__complete`** (hidden) — The dynamic completion engine, called on every TAB press

The generated shell scripts are thin wrappers. When a user presses TAB, the shell calls:

```
mycli __complete --shell bash -- <partial-tokens>
```

All logic runs in JavaScript: parsing the command line context, resolving candidates, and returning results with directives that tell the shell how to present them.

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

1. **Explicit `custom`** — `choices` or `shellCommand`
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
