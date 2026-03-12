---
"politty": patch
---

Clean up orphaned and stale section markers in update mode

- Remove orphaned section markers when a command is deleted from the file
- Clear stale section content (preserving empty markers) when generated output no longer includes a section (e.g., options emptied by globalArgs filtering)
