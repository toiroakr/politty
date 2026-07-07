---
"politty": patch
---

Fix `engines.node` to accurately reflect the runtime requirement. The package uses `node:util`'s `styleText`, which was added in Node 20.12.0 / 21.7.0; the previous `>=18` declaration allowed installs that crashed on import with `SyntaxError: The requested module 'node:util' does not provide an export named 'styleText'`. The build target was also updated from `node18` to `node20.12` to match.
