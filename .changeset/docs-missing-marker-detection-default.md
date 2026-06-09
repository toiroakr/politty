---
"politty": minor
---

Detect missing section markers by default in docs golden tests (**breaking**)

Previously, sections whose markers were absent from a documentation file were silently skipped unless `POLITTY_DOCS_DOCTOR=true` was set, so newly added sections (e.g. a new `notes` field) could drift out of published docs without failing CI. Missing-marker detection now runs by default in marker-based comparison: read-only runs report missing markers as errors, and `POLITTY_DOCS_UPDATE=true` alone inserts them.

Migration:

- If validation now fails with `[doctor] Missing section marker`, run with `POLITTY_DOCS_UPDATE=true` to insert the missing markers.
- To intentionally omit a section, use a custom renderer that returns an empty string (e.g. `format: { renderNotes: () => "" }`) — sections absent from the generated output are never flagged.
- To restore the legacy silent-skip behavior, set `doctor: false` in the config. The `POLITTY_DOCS_DOCTOR` env var overrides the config for a single run (`false`/`0` to skip, `true`/`1` to force).
