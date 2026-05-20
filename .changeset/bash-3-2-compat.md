---
"politty": patch
---

Generated bash completion scripts now run on Bash 3.2 — including the default `/bin/bash` shipped with macOS — even when the CLI uses `completion.custom.expand` or `completion.custom.resolve`. Associative arrays (`declare -gA`, `local -A`) used by the expand path are replaced with prefix-scalar variables read via indirect expansion (`${!varname}`); the two `mapfile` calls in the expand and resolve paths are rewritten as portable `while IFS= read -r` loops. zsh and fish output are unchanged.

A new `Bash 3.2 compatibility (macOS /bin/bash)` CI job runs the bash completion test suite under `/bin/bash` to guard against regressions. Test helpers honor `POLITTY_BASH_BIN` for local verification: `POLITTY_BASH_BIN=/bin/bash pnpm test -- shell-completion/bash`.
