---
"politty": patch
---

Add template-based documentation generation. A new `templates` option on `GenerateDocConfig` maps output paths to template files containing `{{politty:...}}` placeholders; the output is fully generated from the template and contains no politty markers. Templates can exclude specific placeholders with `politty.exclude` front matter.
