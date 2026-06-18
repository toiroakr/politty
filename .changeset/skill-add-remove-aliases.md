---
"politty": patch
---

`skills add` now accepts `install` and `skills remove` accepts `uninstall` as aliases, matching the verbs most package-manager-trained users reach for first. Both spellings dispatch to the same command, so existing invocations continue to work; help output lists the aliases under each command.
