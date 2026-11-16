---
"@politty/loculus": patch
"@politty/zod": patch
"@politty/valibot": patch
"@politty/zod-mini": patch
"politty": patch
---

Add `gracefulShutdown` to `defineCommand` for commands that run until stopped, such as dev servers and file watchers. Under `runMain`, the first SIGINT or SIGTERM received while `run` is executing aborts the new `args.$signal` instead of interrupting the command, so `run` can shut down and return: the command then exits with code 0 and `cleanup` receives no error. A second signal interrupts as before. `args.$signal` is also aborted when any other command is interrupted. While an interrupt's own cleanup is running, the command no longer runs `cleanup` a second time when `run` settles, nor starts `setup` or `run` when the signal arrived before them.
