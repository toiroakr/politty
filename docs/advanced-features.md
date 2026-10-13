# Advanced Features

## Subcommands

politty supports Git-style subcommands that can be infinitely nested or lazily loaded.

### Defining Subcommands

Use the `subCommands` property in `defineCommand`.

```typescript
const init = defineCommand({
  name: "init",
  run: () => console.log("Initializing..."),
});

const build = defineCommand({
  name: "build",
  run: () => console.log("Building..."),
});

const cli = defineCommand({
  name: "app",
  subCommands: {
    init,
    build,
  },
});
```

### Lazy Loading

For large CLIs, you can lazy-load subcommands to reduce startup time. Instead of directly importing commands, provide an async function that uses dynamic import (`import()`).

> **Note**: To benefit from lazy loading, you must use dynamic import (`import()`).
> Static imports at the top of the file (`import { ... } from "..."`) resolve modules immediately when the file is loaded, so they won't be lazily loaded.

```typescript
// ❌ Static import - resolves immediately when file is loaded
import { heavyCommand } from "./commands/heavy.js";

const cli = defineCommand({
  subCommands: {
    // heavyCommand is already loaded
    heavy: async () => heavyCommand,
  },
});
```

```typescript
// ✅ Dynamic import - loads only when subcommand is executed
const cli = defineCommand({
  subCommands: {
    heavy: async () => {
      const { heavyCommand } = await import("./commands/heavy.js");
      return heavyCommand;
    },
  },
});
```

See `playground/21-lazy-subcommands.ts` for a complete example.

### Optional External Packages

Declare `requiredPackages` on a command to load a package before its `setup` and `run` hooks. The package is resolved only when the command executes. If it is missing, politty returns a failed result with its name and the installation command; `runMain` prints the error and exits with a nonzero status. Packages are never installed automatically.

```typescript
import { arg, defineCommand, loadPackage, runMain } from "politty";
import { z } from "zod";

const studioPackage = {
  name: "@lines-db/studio",
  install: "npm install -D @lines-db/studio",
};

const studio = defineCommand({
  name: "studio",
  requiredPackages: [studioPackage],
  args: z.object({ file: arg(z.string(), { positional: true }) }),
  run: async (args) => {
    const module = await loadPackage<{ start: (file: string) => Promise<void> }>(studioPackage);
    await module.start(args.file);
  },
});

const cli = defineCommand({
  name: "lines-db",
  subCommands: { studio },
});

runMain(cli);
```

Omit `install` to automatically generate a development-dependency installation command. politty searches from the package resolution base upward, checking `package.json`’s supported `packageManager` declaration before lockfiles at each directory. It supports npm, pnpm, Yarn, and Bun, and falls back to `npm install -D` when none is detected. An explicit `install` always takes precedence. When multiple lockfiles coexist without a supported declaration, pnpm takes precedence, then Bun, Yarn, and npm. Help (including JSON help) and missing-package errors show the same generated command. Detection does not invoke a package manager or install anything.

By default, packages are resolved from the current working directory, so dependencies installed in the consuming project are found. Set `from: import.meta.url` (or another absolute module URL) to resolve relative to a specific CLI module instead. Import-only package exports are supported. Resolution uses the standard `node` and `import` export conditions; custom Node conditions (such as `--conditions=development`) and custom module loaders are not supported. Packages must expose an entry point under the standard conditions. A missing dependency inside an installed package, a broken entry point, or an initialization error retains its original error.

Use `when` for an option that activates an optional feature. It receives the parsed and validated arguments, including defaults and global arguments. Supply a `description` to explain the condition in help.

```typescript
const uiPackage = {
  name: "@vitest/ui",
  install: "npm install -D @vitest/ui",
};

const test = defineCommand({
  name: "test",
  args: z.object({ ui: arg(z.boolean().default(false)) }),
  requiredPackages: [{ ...uiPackage, description: "--ui", when: (args) => args.ui }],
  run: async (args) => {
    if (args.ui) {
      const module = await loadPackage<{ start: () => Promise<void> }>(uiPackage);
      await module.start();
    } else {
      await runTests();
    }
  },
});
```

Here, `test` and `test --no-ui` work without the UI package, while `test --ui` loads it. Calls to `loadPackage` use Node's module cache, so a package loaded by `requiredPackages` is not initialized again by the run hook. Its generic type describes the module namespace; omit it to receive `unknown`.

For a whole command supplied by an external package, put unconditional requirements on the synchronous metadata passed to `lazy()`:

```typescript
import { lazy, type AnyCommand } from "politty";

const cli = defineCommand({
  name: "lines-db",
  subCommands: {
    studio: lazy(
      defineCommand({
        name: "studio",
        requiredPackages: [studioPackage],
        args: z.object({ file: arg(z.string(), { positional: true }) }),
      }),
      async () => (await loadPackage<{ command: AnyCommand }>(studioPackage)).command,
    ),
  },
});
```

Unconditional requirements are loaded before the lazy loader runs. Conditional requirements belong on the runnable command, where validated arguments are available. Provide the complete help and argument definitions in the metadata: `studio --help`, `--help-all`, and `--help-json` use it without calling the loader. Validation and documentation generation also use this synchronous metadata for commands with requirements, without invoking their loaders. Root help lists each subcommand's requirements, and JSON help includes each requirement's `name`, `install`, and optional `description`.

### Nested Subcommands

Subcommands can have their own `subCommands`.

```typescript
const remoteAdd = defineCommand({ name: "add" /* ... */ });
const remoteRemove = defineCommand({ name: "remove" /* ... */ });

const remote = defineCommand({
  name: "remote",
  subCommands: {
    add: remoteAdd,
    rm: remoteRemove,
  },
});

const cli = defineCommand({
  subCommands: { remote },
});
```

```bash
$ my-cli remote add origin https://github.com/...
```

### Command Aliases

Subcommands can define `aliases` to allow invocation by alternative names. Aliases are displayed in help output and shell completions.

```typescript
const install = defineCommand({
  name: "install",
  description: "Install packages",
  aliases: ["i", "add"],
  run: () => console.log("Installing..."),
});

const cli = defineCommand({
  name: "pkg",
  subCommands: { install },
});
```

```bash
$ pkg install lodash   # canonical name
$ pkg i lodash         # alias
$ pkg add lodash       # alias
```

Alias names must start with an alphanumeric character and contain only alphanumeric characters, hyphens, or underscores. Aliases must not conflict with other subcommand names or aliases at the same level.

> **Note**: Aliases require synchronous metadata, so they work with eagerly-defined commands and `lazy(meta, load)` subcommands. Legacy async subcommand functions (`async () => ...`) do not expose metadata synchronously, so aliases defined on the returned command won't be recognized for parsing, help, or completion. Use `lazy()` for alias-enabled lazy subcommands.

#### Knowing which name `run` was invoked with

`args.$invocation` reports the name actually typed on the CLI to reach the running command, and — only when that name was an alias — the canonical name it resolves to:

```typescript
const install = defineCommand({
  name: "install",
  aliases: ["i", "add"],
  run: (args) => {
    // $pkg install lodash  -> { name: "install" }
    // $pkg i lodash        -> { name: "i", aliasFor: "install" }
    if (args.$invocation?.aliasFor) {
      console.log(`invoked via alias "${args.$invocation.name}"`);
    }
  },
});
```

`args.$invocation.aliasFor` is `undefined` when the command was reached by its canonical name (or run directly, with no subcommand routing involved), so `if (args.$invocation?.aliasFor)` is the idiomatic way to check "was this an alias" without hard-coding alias strings. Branching on a _specific_ alias still requires comparing `args.$invocation.name` against one of the strings in `aliases`.

See `playground/26-command-alias` for a complete example.

## AI Coding Agents

Coding agents (Claude Code, Codex, Cursor, Gemini CLI, ...) run CLIs as often as humans do, but want different things from them. politty detects them from the environment so a CLI can tell agents things humans don't need, and switch defaults for them.

### Agent-only help

`agentHelp` is prepended to `--help` / `--help-all` output (and to the help shown for a missing or unknown subcommand) only when an agent is detected. It is Markdown, rendered the same way as `notes`:

```typescript
runMain(cli, {
  agentHelp: [
    "**AGENTS:** Pass `--json` and parse stdout instead of the table output.",
    "Use `--help-json` for machine-readable help of a single command.",
  ].join("\n"),
});
```

Pass a function to vary it per agent or command; return `undefined` to show nothing:

```typescript
runMain(cli, {
  agentHelp: ({ agent, commandPath }) =>
    commandPath.length === 0
      ? `Detected ${agent.id}. Run \`my-cli search <task>\` first.`
      : undefined,
});
```

`--help-json` carries the same text (raw Markdown) as its `agentHelp` field.

### Knowing whether an agent is running the command

The detected agent is available as `args.$agent` in `run`, `setup` and `cleanup` (non-enumerable, like `$source`/`$invocation`), and as `agent` in the global `setup`/`cleanup` contexts. Both are `undefined` when no agent is detected:

```typescript
const list = defineCommand({
  name: "list",
  args: z.object({ json: arg(z.boolean().optional()) }),
  run: (args) => {
    const json = args.json ?? args.$agent !== undefined;
    // ...
  },
});

runMain(cli, {
  setup: ({ agent }) => {
    telemetry.setAttribute("cli.agent", agent?.id ?? "none");
  },
});
```

Outside a command, call `detectAgent()` from the `agent` subpath (e.g. `politty/agent`) directly. See [`detectAgent`](./api-reference.md#detectagent) for how agents are detected.

## Complex Schemas

### Discriminated Union (Mutually Exclusive Options)

Use `z.discriminatedUnion` to create mutually exclusive argument sets. This is ideal for commands where a "mode" argument determines which other arguments are valid (and required).

```typescript
const args = z
  .discriminatedUnion("mode", [
    // Mode 1: File input
    z
      .object({
        mode: z.literal("file"),
        path: arg(z.string(), { description: "Input file path" }),
      })
      .describe("Input from file"),
    // Mode 2: URL input
    z
      .object({
        mode: z.literal("url"),
        url: arg(z.string().url(), { description: "Input URL" }),
        method: arg(z.enum(["GET", "POST"]).default("GET")),
      })
      .describe("Input from URL"),
  ])
  .describe("Input mode");

const command = defineCommand({
  args,
  run: (args) => {
    if (args.mode === "file") {
      // args.path is valid here
      console.log("Reading file:", args.path);
    } else {
      // args.url is valid here
      console.log("Fetching URL:", args.url);
    }
  },
});
```

#### Setting Descriptions

- **`.describe()` on the entire discriminatedUnion**: Used as the description for the discriminator field (`--mode` in this example)
- **`.describe()` on each variant**: Displayed in the help message for each variant's section

Help text is automatically grouped by variant:

```
Options:
  --mode <file|url>           Input mode

When mode=file: Input from file
    --path <PATH>             Input file path (required)

When mode=url: Input from URL
    --url <URL>               Input URL (required)
    --method <METHOD>         (default: "GET")
```

#### Defining an Argument Differently per Variant

Each variant may define the same argument with its own role. The command line is read with the definitions of the variant the discriminator selects, so `--target` is accepted only by variants that define it as an option (or as a positional with `{ named: true }`), and a positional token fills it only in variants that define it as positional.

```typescript
const args = z.discriminatedUnion("action", [
  z.object({ action: z.literal("deploy"), target: arg(z.string(), { positional: true }) }),
  z.object({ action: z.literal("rollback"), target: arg(z.string()) }),
]);
```

```bash
$ my-cli --action deploy prod          # target = "prod"
$ my-cli --action rollback --target v1 # target = "v1"
$ my-cli --action deploy --target prod # rejected: deploy does not accept --target
```

Help and generated docs list such an argument under each variant with that variant's role. For a `z.union` without a discriminator, the command line is read with the first option whose definitions fit the given tokens: every option is one it accepts, no positional token is left over, and its required arguments are present. When no option fits, the command fails with `Arguments match none of the accepted forms. See --help for the accepted forms.` A discriminated union fails with the same error when the discriminator is given in a role that only another variant uses (for example `--action rollback` while `rollback` takes `action` as a positional), instead of reading the rest of the line with a mix of both variants' definitions.

### Intersection (Schema Composition)

Use `.and()` or `z.intersection()` to combine schemas and reuse common options.

```typescript
const sharedOptions = z.object({
  verbose: arg(z.boolean().default(false), { alias: "v" }),
  json: arg(z.boolean().default(false)),
});

const command = defineCommand({
  args: sharedOptions.and(
    z.object({
      input: arg(z.string(), { positional: true }),
    }),
  ),
  run: (args) => {
    // args has verbose, json, and input
  },
});
```

## Transformations

Use Zod's `transform` to process arguments before they reach the handler.

```typescript
args: z.object({
  // Convert comma-separated string to array
  tags: arg(
    z.string().transform((val) => val.split(",")),
    { description: "Comma-separated tags" },
  ),
});
```

## Appendix: Extending Zod Global Registry

Normally, metadata is managed through the `arg()` function, but you can also extend Zod's global type definition to store metadata directly in `_def`.

### Using Zod `.meta()`

By importing `politty/augment`, you can use Zod's standard `.meta()` method to define argument metadata. This allows for cleaner definitions without the `arg()` helper.

```typescript
import "politty/augment"; // Required: Enable .meta() type extension (TypeScript only)
import { z } from "zod";
import { defineCommand } from "politty";

const command = defineCommand({
  args: z.object({
    name: z.string().meta({
      positional: true,
      description: "User name",
    }),
    verbose: z.boolean().meta({
      alias: "v",
      description: "Verbose mode",
    }),
  }),
  run: (args) => {
    // ...
  },
});
```

This feature is implemented by extending Zod's `GlobalMeta` interface.
