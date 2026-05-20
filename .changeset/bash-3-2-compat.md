---
"politty": patch
---

Generated bash completion scripts now run on Bash 3.2 — including the default `/bin/bash` shipped with macOS — even when the CLI uses `completion.custom.expand` or `completion.custom.resolve`. Associative arrays (`declare -gA`, `local -A`) used by the expand path are replaced with prefix-scalar variables read via indirect expansion (`${!varname}`); the two `mapfile` calls in the expand and resolve paths are rewritten as portable `while IFS= read -r` loops. zsh and fish output are unchanged.

Regression coverage: snapshot assertions in the bash test suite guard against `declare -A` / `declare -gA` / `local -A` / `mapfile` / `readarray` leaking back into the generated script. Test helpers also honor `POLITTY_BASH_BIN` so the bash test suite can be re-run under arbitrary bash binaries (e.g. `POLITTY_BASH_BIN=/bin/bash pnpm test -- shell-completion/bash` to exercise the macOS default bash locally).
