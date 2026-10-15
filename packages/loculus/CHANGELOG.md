# @politty/loculus

## 0.1.1

### Patch Changes

- b35de48: Add the Loculus adapter with inferred command types, argument metadata, defaults, environment fallbacks, typed literal choices, discriminated unions, shell completion, help, docs, prompts, agent helpers and CLI entry points.

  Require `loculus ^0.2.4` to preserve scalar discriminator conversion and refinement/transform callbacks in wrapped composites. Support optional build-time optimization with `@loculus/rolldown` 0.2.2 or newer in the 0.2 line, preserving post-bundle execution and generated help, docs and completion.

- 4f7ec00: Support Node.js 22.18.0 and newer with the Loculus adapter and compile its output for that Node.js version. Require loculus ^0.2.5, whose declared Node.js requirement includes Node.js 22.18.0.
