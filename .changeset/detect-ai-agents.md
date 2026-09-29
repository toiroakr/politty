---
"@politty/valibot": patch
"@politty/zod": patch
"@politty/zod-mini": patch
"politty": patch
---

Detect AI coding agents (Claude Code, Codex, Cursor, Gemini CLI, ...) following the vercel/detect-agent spec. Adds `detectAgent()` on a new `agent` subpath, a `runMain`/`runCommand` `agentHelp` option that prepends agent-only guidance to `--help` (and adds it to `--help-json`), `args.$agent` in `run`/`setup`/`cleanup`, and `agent` in the global `setup`/`cleanup` contexts. Set `POLITTY_NO_AGENT=1` to opt out.
