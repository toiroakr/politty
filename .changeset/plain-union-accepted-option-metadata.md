---
"@politty/loculus": patch
"@politty/zod": patch
"@politty/valibot": patch
"@politty/zod-mini": patch
"politty": patch
---

Use the field metadata (`effect`, `requiredPackages`, nested paths for merging global and command values) of the plain-union option that accepted the args instead of the first option defining the field name. Options are only re-validated when they define a same-named field with different metadata, or when only some options define a field with an `effect` or `requiredPackages`.
