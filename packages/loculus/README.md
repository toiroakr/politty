# @politty/loculus

Politty with [loculus](https://github.com/toiroakr/loculus) flat string-input schemas. Requires Node.js 22.18.0 or newer. Uses the same core command execution, help, docs, completion, prompt, skills and agent functionality as `@politty/zod`.

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

To receive related options as a nested object, declare them with dotted keys and wrap the schema with `unflatten` from `@politty/loculus` (not the one from `loculus`, which politty could not follow to the nested values): `unflatten(l.object({ "db.host": l.string() }))` hands `run` `{ db: { host } }`. Options, `arg()` metadata and issue paths stay flat.

Constructor `nullable` / `nullish` flags preserve null output types. A scalar `default` applies to undefined; `default: { nullish: value }` applies to undefined and null. Null-only defaults still require an argument. Help displays only the undefined default, because CLI omission produces undefined.

Loculus 0.2.4 supports string, boolean and numeric literal fields with exact output types. Boolean literals use boolean CLI flags; numeric literals accept numeric strings. Literal choices appear in JSON help and completion, and typed literals can select discriminated command branches.

Multi-value literals also work as CLI fields: `l.literal([1, 2, 3])`, `l.literal([true, false])` and `l.literal([true, "auto"])` infer their output unions and expose choices to help/completion. Mixed boolean/string fields take an explicit value, for example `--mode true` or `--mode auto`.

Numeric discriminators accept the same decimal spellings as numeric fields: `--edition 2`, `--edition 2.0` and `--edition 2e0` select the same branch for execution and dynamic completion. Different branches must have distinct CLI spellings: a numeric `1` and a string `"1"` cannot identify separate branches. Such schemas fail during command metadata extraction.

Public subpaths: `docs`, `completion`, `skill`, `agent`, `prompt`, `prompt/clack`, `prompt/inquirer`, `compile-cache`, `cli`. The optional prompt integrations use the same optional peers as `@politty/zod`. No Zod or Valibot runtime is loaded.

Flat objects, discriminated unions, ordinary unions, xor and intersections are supported. Loculus 0.2 supports finite nested objects and multidimensional arrays, but Politty CLI arguments remain flat: nested object fields and nested arrays have no dedicated token mapping. Arbitrary recursive schemas and asynchronous validation are outside the supported CLI contract. `arg` replaces Zod-specific `.meta()` augmentation; a Zod `augment` subpath is therefore unnecessary.

Composite schemas use their branches' common CLI unknown-flag policy. When the branches have different policies, they use the core's default strip-with-warning policy, independent of branch order.

Arrays require array inputs by default in Loculus 0.2. Politty collects repeated CLI values into arrays, so `--tags a` and `--tags a --tags b` work without `wrapScalar`. Environment fallbacks supply strings, so array fields with `env` need `wrapScalar: true`. Non-CLI callers passing scalar values need the same option.

## Build-time optimization

Loculus 0.4.0 or newer in the 0.4 line can be used with `@loculus/rolldown` 0.3.1 or newer in the 0.3 line to specialize supported static schemas during the CLI build. The generated validators preserve the metadata used by help, docs, completion and prompts. Dynamic or unsupported definitions retain ordinary validation.

```ts
import { defineConfig } from "tsdown";
import { loculusPlugin } from "@loculus/rolldown";

export default defineConfig({
  entry: ["src/main.ts"],
  plugins: [loculusPlugin()],
});
```

The plugin requires Node.js 22.18.0 or newer at build time and Rolldown `>=1.2.13 <2`. It is optional and belongs in the CLI project's devDependencies.

## Development

The adapter uses the published `loculus` 0.4.1 package for development and requires `loculus ^0.4.0` at runtime. No local archive or adjacent loculus checkout is needed.

This repository's first-package release procedure in CLAUDE.md applies to `@politty/loculus`.

The `dist-compat` CI suite bundles a complete CLI with each Rolldown object strategy and compares post-bundle execution, help, generated docs, completion and prompts against an unoptimized bundle on Linux and Windows.
