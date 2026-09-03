# @politty/zod

## 0.2.0

### Minor Changes

- 53fdf95: Shrink the package entry point by no longer statically bundling the shell-completion generators (bash/zsh/fish, the dynamic `__complete` engine, and the on-disk install/refresh logic) into it. `withCompletionCommand` still works exactly as before, but its `completion`/`__complete`/`__refresh-completion`/`__completion-worker-path` subcommands now load lazily, only when one of them actually runs.

  **Breaking:** `generateCompletion` and `generateBundledCompletionWorker` are no longer exported from the package root. Both were already documented as importing from the `/completion` subpath — update any code that imported them from the root instead:

  ```diff
  - import { generateCompletion } from "politty";
  + import { generateCompletion } from "politty/completion";
  ```

  (same for `@politty/zod`/`@politty/valibot`, and for `generateBundledCompletionWorker`). `withCompletionCommand` itself is unaffected — keep importing it from the package root.

  Builds are also minified now, cutting total published package size by more than half on top of the entry-point reduction above (`@politty/zod`'s dist JS: 620KB → 269KB).

### Patch Changes

- 2bd32e7: chore(deps): lock file maintenance
- 791cfb8: Fix the zod adapter to recurse through `pipe` wrapper nodes (`.transform()`/`.refine()`), not just `optional`/`nullable`/`default`, in three places:

  - `extractDefaultValue` and `extractDescription`: a default or description declared before a transform pipe (e.g. `z.string().default("hello").transform((s) => s.toUpperCase())`) was silently dropped from `ResolvedFieldMeta`, even though the default itself was applied correctly at parse time — producing an internally inconsistent `required: false` with no visible default in help text and generated docs.
  - `getArgMeta`: `arg()` metadata (alias, description, etc.) registered on a schema that is then wrapped in `.default()`/`.optional()`/`.nullable()` and piped through a transform (e.g. `arg(z.string().default("info"), { alias: "L" }).transform(...)`) was silently dropped, since only the outer pipe and the fully-unwrapped inner schema were checked, skipping the intermediate wrapper the metadata was registered on.

## 0.1.2

### Patch Changes

- 45e4ca2: Add `args.$invocation` to expose the CLI name (or alias) a command's `run()` was actually invoked with: `{ name }` when invoked by its canonical name (or run directly, with no subcommand routing involved), or `{ name, aliasFor }` when `name` is one of the command's `aliases` and `aliasFor` is the canonical name it resolves to. This lets `run()` tell which alias was used without hard-coding alias strings to detect the "was this an alias at all" case (`if (args.$invocation?.aliasFor)`).
- 9ca2435: `validateCommand()` now flags a subcommand registered under a `subCommands` key that differs from its own `name` (e.g. `subCommands: { foo: installCommand }` where `installCommand.name === "install"`) as a new `subcommand_key_name_mismatch` error. Routing, help text, shell completion, and `args.$invocation` all key off the registration key rather than the subcommand's own `name`, so a mismatch silently produces a canonical name that disagrees with the command's own declared name. This check only runs when `validateCommand()` is explicitly called (it is opt-in, like the rest of `validateCommand`'s checks) — it does not change runtime behavior.

## 0.1.1

### Patch Changes

- 00f37cf: Support line breaks (`\n`) in descriptions across help and generated docs.

  In terminal help output, multi-line descriptions now have their continuation
  lines indented to stay aligned under the description column. In generated
  Markdown, embedded line breaks are converted to `<br>` so they render as line
  breaks inside a single table cell or list item instead of breaking the
  surrounding table row / list structure.

- f002d3d: Correct `peerDependencies` lower bounds and verify them in CI.

  `peerDependencies` floors had never actually been installed and tested, so Renovate's `rangeStrategy: "bump"` (which is meant for exclusive `dependencies`/`devDependencies` copies, not floors declared for consumers) had silently pushed them past what's really required: `zod` to `^4.4.3` (actually works from `^4.2.1`) and `@inquirer/prompts` to `^8.5.2` (actually works from `^8.3.2`) in `politty` and `@politty/zod`; `@inquirer/prompts` the same way, plus `valibot` to `^1.4.2`, in `@politty/valibot`. Installing the originally-declared `valibot` floor (`^1.0.0`) turned up a real gap instead — `v.multipleOf()`'s bigint overload, which `@politty/valibot`'s adapter type-checks against, isn't present before `1.1.0` — so that floor is corrected upward to `^1.1.0` rather than restored.

  `renovate.json` now widens `peerDependencies` instead of bumping them, and CI installs each package's exact declared peer floor and runs the test suite against it, so a future floor drift gets caught before merge instead of silently shipping.

## 0.1.0

### Minor Changes

- 1ce9b90: Split the repository into a pnpm workspace of three packages:

  - `@politty/core` (private): the validator-agnostic framework — parser, runner, help, completion, docs, skill, and prompt layers. It is never published; adapter packages bundle it at build time.
  - `@politty/zod` (new): the user-facing package for building politty CLIs with zod v4 schemas. It registers the zod validator adapter on import, re-exports the full core API, and ships the `politty` bin.
  - `politty`: now a compatibility alias of `@politty/zod`. Runtime modules re-export `@politty/zod` (so mixing the two packages in one process shares a single adapter registry and arg-metadata store), every existing subpath export (`politty/docs`, `politty/completion`, `politty/skill`, `politty/prompt`, `politty/prompt/clack`, `politty/prompt/inquirer`, `politty/augment`, `politty/compile-cache`) and the `politty` bin keep working, and `declare module "politty"` GlobalArgs augmentation still merges. No API changes for existing users.

### Patch Changes

- 20e0eca: Fix `generate-shim` baking a fixed import specifier into the shims it writes.

  The generated bin shim enables the Node.js compile cache by importing `enableCompileCache`, and that import specifier was hard-coded with no way to change it. A CLI depending on this package could not resolve the hard-coded one from its own package, so the shim's `catch` swallowed the failure and the CLI ran with the compile cache permanently disabled — silently, since the shim is designed to degrade rather than fail.

  Each package now generates shims that import from its own `compile-cache` subpath. Reaching the generator at all — through the package's `politty` bin or through an import of it — means that package is installed in the host, so the specifier resolves from the shim that lands there.

  Regenerating an existing shim picks the corrected specifier up, including shims generated before the workspace split — the overwrite marker is unchanged.

  New `--compile-cache-specifier` flag (`compileCacheSpecifier` option) overrides it for setups where the cache helper is reached some other way, such as a re-export from your own package. `generate-shim` now also reports the specifier it used, and `generateCompileCacheShim` returns it as `compileCacheSpecifier` on each result.

- ac7e85a: Add `@politty/valibot`: politty with valibot schemas. The new package exposes the same API surface as `@politty/zod` (`defineCommand`, `arg`, `runMain`, docs/completion/skill/prompt subpaths, and the `politty` bin) backed by a valibot validator adapter, and its published build never loads zod. Field metadata is read from `arg()` as well as valibot's `v.description()` / `v.metadata()` pipe actions.

  Supporting this, `@politty/core`'s public types now constrain schemas through the Standard Schema interface, and each adapter package re-pins the schema-taking API (`ArgsSchema`, `defineCommand`, `createDefineCommand`, `arg`) to its own library's schema type — `@politty/zod` keeps politty's historical zod-typed surface, so existing `politty` / `@politty/zod` users are unaffected, and a schema from the wrong library is now a type error instead of a runtime failure.

  Also fixes two things about wrapped args schemas, in both adapters:

  - Field extraction now unwraps the wrapper. A defaulted wrapper keeps an object output type, so `z.object({...}).default({...})` (and the valibot equivalent) type-checks as an args schema, but extraction fell through to its fallback and returned zero fields — positionals were rejected as "Unexpected positional argument" and help, docs, and completion came out empty for the whole command.
  - Unknown-keys detection unwraps too: `z.strictObject({...}).optional()` (or a top-level `.transform()` pipe) reported `strip`, so unknown CLI flags were warned-and-ignored while validation enforced the inner object's strict behavior.

  In `@politty/valibot`, type detection for the `unknown`-based coercion pipe now finds the pipe wherever composition puts it. Because `v.pipe` spreads its base schema, piping a wrapper leaves the pipe on the wrapper node while the `unknown` it wraps has none, so `v.pipe(v.optional(v.unknown()), v.transform(Number), v.number())` was reported as an `unknown` field in help, prompts, and completion instead of a number.

  Published packages no longer ship `.js` files pointing at source maps that were excluded from the tarball — map emit is off now, so `dist/**/*.js` has no dangling `sourceMappingURL`.

  Every published tarball now carries the MIT `LICENSE` alongside the README. `prepublishOnly` copied only `README.md` from the repo root, so the license text the `"license": "MIT"` field refers to was absent from the package itself.

  Docs generation now identifies a schema by its Standard Schema `~standard` marker instead of probing for zod's `safeParse` method. The old probe misread the shorthand `rootDoc.globalOptions` form when one of its options happened to be named `args`, because valibot schemas expose no `safeParse` — generating docs for such a config crashed.
