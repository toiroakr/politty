---
"@politty/valibot": patch
"@politty/zod": patch
"politty": patch
---

Support line breaks (`\n`) in descriptions across help and generated docs.

In terminal help output, multi-line descriptions now have their continuation
lines indented to stay aligned under the description column. In generated
Markdown, embedded line breaks are converted to `<br>` so they render as line
breaks inside a single table cell or list item instead of breaking the
surrounding table row / list structure.
