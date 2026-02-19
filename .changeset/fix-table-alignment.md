---
"politty": patch
---

Fix table alignment in Markdown renderer when cells contain inline formatting (backticks, bold, italic) or full-width characters. Column widths are now calculated based on visual width using string-width instead of string length.
