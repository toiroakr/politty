---
"politty": patch
---

Clear stale section marker content when generated output no longer includes the section (e.g., options emptied by globalArgs filtering). In check mode, stale markers are now reported as diffs, which may cause CI to fail if markers are out of sync.
