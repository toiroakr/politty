---
"@politty/core": patch
---

Use the field metadata (`effect`, `requiredPackages`) of the plain-union option that accepted the args instead of the first option defining the field name. Options are only re-validated when they define a same-named field with different metadata.
