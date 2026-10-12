# @politty/loculus

Politty with [loculus](https://github.com/toiroakr/loculus) flat string-input schemas. Requires Node 24 or newer. Uses the same core command execution, help, docs, completion, prompt, skills and agent functionality as `@politty/zod`.

```ts
import * as l from "loculus";
import { arg, defineCommand, runMain } from "@politty/loculus";

const command = defineCommand({
  name: "serve",
  args: l.object({
    file: arg(l.string(), { positional: true }),
    port: arg(l.number({ integer: true, gte: 1, lte: 65535, default: 3000 }), {
      alias: "p",
      env: "PORT",
      description: "Listen port",
    }),
    cache: arg(l.boolean({ default: true }), { negation: true }),
    mode: l.enum(["dev", "prod"], { default: "dev" }),
  }),
  run: (args) => console.log(args),
});
await runMain(command);
```

Schema outputs are inferred in `run`. `arg` supports positionals, aliases, hidden aliases, environment fallbacks, completion, prompts, effects and negations. Metadata survives loculus constructor options and transform/refine wrappers. The schema's input kind determines CLI token handling even when a transform changes the output type.

Constructor `nullable` / `nullish` flags preserve null output types. A scalar `default` applies to undefined; `default: { nullish: value }` applies to undefined and null. Null-only defaults still require an argument. Help displays only the undefined default, because CLI omission produces undefined.

Public subpaths: `docs`, `completion`, `skill`, `agent`, `prompt`, `prompt/clack`, `prompt/inquirer`, `compile-cache`, `cli`. The optional prompt integrations use the same optional peers as `@politty/zod`. No Zod or Valibot runtime is loaded.

Flat objects, discriminated unions, ordinary unions, xor and intersections are supported. Nested object fields, arbitrary recursive schemas and asynchronous validation are outside loculus's scope. `arg` replaces Zod-specific `.meta()` augmentation; a Zod `augment` subpath is therefore unnecessary.

Composite schemas use their branches' common CLI unknown-flag policy. When the branches have different policies, they use the core's default strip-with-warning policy, independent of branch order.

## Development before the first loculus release

The devDependency uses `tests/fixtures/loculus/loculus-0.1.0.tgz`, a snapshot of loculus's published package layout, so a clean checkout can build and test without an unpublished npm dependency or an adjacent worktree. Runtime consumers use the `loculus` peer dependency `^0.1.0`. The snapshot contains no additional source implementation.

To update the fixture from a loculus checkout, build loculus and run `pnpm pack --pack-destination <politty-checkout>/tests/fixtures/loculus`, then `pnpm install --force` in politty. Keep the archive version, devDependency and peer range in sync. Once loculus is published, replace the archive devDependency with the npm version and remove the archive.

Publish loculus before publishing `@politty/loculus`. This repository's first-package release procedure in CLAUDE.md applies to the adapter as well. Neither package has been published by this implementation task.
