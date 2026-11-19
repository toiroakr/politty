# Recipes

## Testing

politty is designed with testability in mind. You can simulate command-line execution by passing an `argv` array directly to `runCommand`.

**Vitest** is recommended as a test runner, but any runner will work.

```typescript
import { describe, it, expect, vi } from "vitest";
import { defineCommand, runCommand, arg } from "politty";
import { z } from "zod";

describe("my-cli", () => {
  it("should parse arguments correctly", async () => {
    const logs: string[] = [];
    vi.spyOn(console, "log").mockImplementation((msg) => logs.push(msg));

    const command = defineCommand({
      name: "greet",
      args: z.object({
        name: arg(z.string(), { positional: true }),
      }),
      run: (args) => console.log(`Hello ${args.name}`),
    });

    // Pass arguments directly
    const result = await runCommand(command, ["World"]);

    expect(result.exitCode).toBe(0);
    expect(logs).toContain("Hello World");
  });
});
```

### Testing Inside a Coding Agent

When tests run inside an AI coding agent (Claude Code, Codex, ...), `runCommand` detects it from the inherited environment, so `args.$agent`, the global `setup`/`cleanup` `agent` and `agentHelp` output differ from a CI run. Set `POLITTY_NO_AGENT=1` in the test environment (e.g. vitest's `test.env`) to keep results stable, and re-enable detection only in tests of agent behavior:

```typescript
vi.stubEnv("POLITTY_NO_AGENT", "");
// A known name keeps id stable even if the runner's own agent env leaks in
vi.stubEnv("AI_AGENT", "codex_cli"); // args.$agent => { id: "codex_cli", rawId: "codex_cli" }
```

### Testing Validation Errors

Invalid arguments fail with exit code 2, which separates them from a command that failed while running (exit code 1).

```typescript
it("should fail validation", async () => {
  // Suppress error output
  vi.spyOn(console, "error").mockImplementation(() => {});

  const command = defineCommand({
    name: "test",
    args: z.object({ age: arg(z.coerce.number()) }),
  });

  const result = await runCommand(command, ["--age", "not-a-number"]);

  expect(result.exitCode).toBe(2);
});
```

### Mocking setup/cleanup

To mock `setup` or `cleanup` for an existing command definition, use `vi.spyOn`.

```typescript
import { myCommand } from "./my-command";

it("should mock setup", async () => {
  // Mock setup (make it do nothing)
  vi.spyOn(myCommand, "setup").mockImplementation(() => {});
  vi.spyOn(myCommand, "cleanup").mockImplementation(() => {});

  const result = await runCommand(myCommand, ["--flag", "value"]);

  expect(result.exitCode).toBe(0);
});
```

### Testing a Command with the Options of Your CLI

Pass the command you want to test straight to `runCommand`, whether it is the root command or a subcommand, without naming the parents it sits under. The global args, `setup` and `cleanup` of your CLI belong to `runMain`, so a bare `runCommand(deploy, argv)` runs without them. Pass them in `options` to get the same run as the real CLI:

```typescript
await runCommand(deploy, ["--verbose", "prod"], { globalArgs, setup, cleanup });
```

The type of `args.verbose` needs no import in the command (see [Typing global options in commands](./advanced-features.md#typing-global-options-in-commands)), but the schema itself has to be passed this way at run time. With Vitest, the Vite plugin below removes that repetition, so a test does not change when the command is renamed or moved under another parent.

#### Reusing the options of the CLI (Vite plugin)

`politty/vite` (also `@politty/zod/vite`, `@politty/valibot/vite` and `@politty/zod-mini/vite`) is a Vite plugin for Vitest. It adds a setup file that loads your CLI entry in a `beforeAll` hook, with `runMain` only recording its command and options instead of running, and `runCommand` then uses what was recorded. The hook runs after the test file has been evaluated and before its tests, so the `vi.mock` calls of the test file apply to the modules that the entry imports, and nothing else of the test file runs while the entry is loaded. A test file that loads no politty module, directly or through a helper it imports, does not load the entry. If the hook did not load it, the first `runCommand` call does. With `isolate: false`, Vitest shares modules between test files, so the entry is loaded once and the recording is reused.

```typescript
// vitest.config.ts
import { defineConfig } from "vitest/config";
import { politty } from "politty/vite";

export default defineConfig({
  plugins: [politty({ tsconfig: "./tsconfig.json" })],
});
```

If you do not use the content mapper, name the entry directly with `politty({ entry: "./src/cli.ts" })`, relative to the Vite root (the `--root` of Vitest takes precedence over the root of the Vite config); no tsconfig is read then, and you type the global options with [declaration merging](./advanced-features.md#typing-global-options-in-commands) or `createDefineCommand<T>()` instead.

`tsconfig` is the file that configures the [politty content mapper](./advanced-features.md#deriving-globalargs-from-runmain-content-mapper), relative to the Vite root (default `./tsconfig.json`). The plugin reads the `entry` option there, so the entry is written once for the type checker and for the tests. The file is read as written: `extends` is not followed.

A test then needs no import for the global options:

```typescript
import { expect, it } from "vitest";
import { runCommand } from "politty";
import { deploy } from "./deploy";

it("deploys with the global options of the CLI", async () => {
  const result = await runCommand(deploy, ["--verbose", "prod"]);

  expect(result.success).toBe(true);
});
```

- `runCommand` looks `deploy` up by reference in the recorded command tree and runs it from the root through its real path, as `mycli ops deploy --verbose prod`. The root command itself is found as well and runs with the recorded options. Renaming `deploy` or moving it under another parent does not change the test. When a command is registered under several parents, the first matching declared path wins; paths that need loading are considered only afterwards.
- Commands declared in the tree, including the metadata of `lazy()` subcommands, are matched without loading anything. Only when that finds nothing, for a command that a `lazy()` or async subcommand returns or for a command outside the tree, the `lazy()` and async subcommands are loaded, starting with the ones named like the command. A loader that uses `import()` loads each module once.
- The lookup runs before `setup`, and a loader that it called is called again when the command runs. A loader that needs state from `setup`, that throws (a missing `requiredPackages` prerequisite, for example), or that returns a different command each time is skipped by the lookup, and the command then runs as if it were outside the recorded tree. A loader that waits for `setup` to finish never settles, and the lookup waits for it as well.
- The recorded `globalArgs`, `setup` and `cleanup` apply as in the real CLI. The help of the subcommand shows its full path.
- Options you pass to `runCommand` win, key by key. Pass `{ setup: undefined }` to run without the recorded `setup`. Only these three options are taken from the recorded call; `prompt` and the others are not. A `runCommand` call made inside the recorded `setup` or `cleanup`, or inside the `run` of a command that `runCommand` is running through the recorded CLI, does not use the recorded CLI at all: it runs as it does without the plugin, so it neither inherits the hooks again nor looks the command up in the recorded tree.
- A command that is not in the recorded tree runs without the recorded options, as it does without the plugin. The lookup that found nothing may have loaded `lazy()` subcommands.
- The real CLI runs an internal command (a command registered under a top-level key that starts with `__`) without the global args, `setup` and `cleanup`, and so does `runCommand` here.
- The entry has to call `runMain` while its module is evaluated, or within one second after: a top-level `await runMain(...)` is fine, and so is a call that an asynchronous start-up makes shortly after the import. A later call runs the real CLI. The entry runs in the test process before the tests of each test file that loads politty, directly or through another module, so keep it free of work that must not happen in a test run, and do not import it from a test. When it throws before it calls `runMain`, the first `runCommand` call rejects with the error.
- With `isolate: false`, the recording is reused for the same entry for the lifetime of the worker. It is not refreshed when Vitest resets or invalidates the modules (`vi.resetModules()`, or a rerun in watch mode); `runCommand` then no longer finds your command in the recorded tree and runs it without the recorded options. Restart the run, or keep the default `isolate: true`.
- Put `politty()` in the `plugins` of the project that runs the tests. An inline project that only shares the root Vite config does not receive the setup file that the root plugin adds, so its tests run without the recorded options.

## Runtime Configuration

### Signal Handling (Ctrl+C)

When using `runMain`, exit signals (SIGINT, SIGTERM) are automatically handled and the `cleanup` hook is executed. This ensures that `cleanup` is called even when the user interrupts the process.

> **Note:** `runCommand` is intended for testing purposes and does not handle signals. Use `runMain` in production environments.

An interrupted command exits with code 1, and `cleanup` receives an `Error("Process interrupted")`. A command that runs until it is stopped, such as a dev server or a file watcher, can set `gracefulShutdown: true` to treat a stop signal as the normal way to end. The first SIGINT or SIGTERM received while `run` is executing then only aborts `args.$signal`: `run` shuts down and returns, and the command finishes like any other run, with exit code 0 and no error passed to `cleanup`.

```typescript
const serve = defineCommand({
  name: "serve",
  args: z.object({ port: arg(z.coerce.number().default(3000)) }),
  gracefulShutdown: true,
  run: async (args) => {
    const stopped = new Promise((resolve) => args.$signal?.addEventListener("abort", resolve));
    const server = await startServer(args.port);
    await stopped;
    await server.close();
  },
});
```

- Add the `abort` listener before the first `await` in `run`: a signal can arrive while `startServer()` is pending, and a listener added after the abort never fires.
- If `run` throws after the stop request, for example an `AbortError` from an API that was given `args.$signal`, the command fails with that error as usual.
- A second signal while `run` is still executing interrupts the command, so a shutdown that hangs can still be stopped. A signal before `run` starts (during `setup`) also interrupts it. Once `run` has returned, `runMain` no longer handles signals: another one terminates the process at once, without finishing `cleanup` or running the global `cleanup`, as it does during an interrupted command's `cleanup`.
- `args.$signal` is also aborted when a command without `gracefulShutdown` is interrupted, so `run` can stop in-flight work while `cleanup` runs. `runCommand` never aborts it; to test a `gracefulShutdown` command, call its `run` with your own signal, e.g. `serve.run({ port: 3000, $signal: controller.signal })`.
- For a [`lazy()`](./advanced-features.md#lazy-loading) subcommand, set `gracefulShutdown` on the loaded command.

### Debug Mode

Enable debug mode to display complete stack traces instead of just error messages when errors occur.

```typescript
runMain(command, {
  debug: true,
});
```

### Loading Env Files (`--env-file`)

Mark a global option with `envFile` and politty loads the files it names into `process.env` before any `env` fallback is applied, like Node.js `--env-file` and `--env-file-if-exists`:

```typescript
runMain(cli, {
  globalArgs: z.object({
    "env-file": arg(z.string().array().optional(), { alias: "e", envFile: true }),
    "env-file-if-exists": arg(z.string().array().optional(), { envFile: "if-exists" }),
    json: arg(z.boolean().default(false), { alias: "j", env: "MY_CLI_JSON" }),
  }),
});
```

- `envFile: true` fails with `Environment file not found: <absolute path>` (exit code 2) when a file does not exist. `envFile: "if-exists"` skips a missing file.
- Files are read after `--help` and `--version` are recognized, so `my-cli deploy --help -e missing.env` still prints the help. They are read before every `env` fallback, so a value in `org.env` reaches an option declared with `env: "ORG_ID"`, and `MY_CLI_JSON` in an env file turns `json` on. `-je org.env` is split correctly because politty knows which options are boolean.
- Files load in option declaration order, then in the order given on the command line. `my-cli -e a.env deploy -e b.env` reads `a.env` and then `b.env`: a later file overrides an earlier one, and a variable that was already set in the environment is never overridden.
- When an unknown subcommand is forwarded to a plugin (`onUnknownSubcommand`), the host does not read the files; the plugin reads them itself and reports a missing one. A CLI whose plugins need the variables in their environment can call [`loadEnvFiles(globalArgs)`](./api-reference.md#loadenvfiles) from the handler first.
- `envFile` belongs on a `globalArgs` option whose value is a string or an array of strings; any other option type throws when the schema is read. Use an array so that the option can be repeated. When the option is given both before and after a subcommand (`cli -e a.env deploy -e b.env`), an array option's value lists every path, outer first (`["a.env", "b.env"]`); other array options, and a single-string `envFile` option, keep only the later value (every file is still read).
- A command group (subcommands without a `run`) does not read the files; only the leaf command that runs does, so a mistyped subcommand is reported as such. If a `globalArgs` union declares the same option in several variants, every variant must use the same `envFile` setting, otherwise `runMain` / `runCommand` throws when the schema is read.
- The variables stay in `process.env` even if the run then fails validation, as with Node.js `--env-file`. When one of the files is missing, none of them is applied.

### Faster Startup (Compile Cache)

Node.js (>= 22.8.0) can persist compiled V8 bytecode to disk so warm starts skip recompilation. `runMain` enables this automatically: the cache lives in `${XDG_CACHE_HOME:-$HOME/.cache}/<command name>/node-compile-cache` (shared with the shell-completion workers), the `NODE_COMPILE_CACHE` environment variable takes precedence (Node.js honors it at process startup, so it applies even with `compileCache: false`), and older runtimes are a silent no-op.

```typescript
// Opt out, or pin a custom directory:
runMain(command, { compileCache: false });
runMain(command, { compileCache: "/custom/cache-dir" });
```

The automatic enablement only covers modules imported _after_ `runMain` starts — for example [`lazy()` subcommands](./advanced-features.md); your entry file's static import graph (politty, zod, your commands) is compiled before any code runs, so it never hits a cache enabled that late (the `compile-cache` subpath's JSDoc explains why). To cache the whole CLI, make your bin a minimal shim that enables the cache first and loads the real entry with a dynamic import.

The easiest way is to let the `politty` CLI generate the shim as part of your build, so it never has to live in source:

```jsonc
// package.json
{
  "bin": { "my-cli": "./dist/bin.js" },
  "scripts": {
    "build": "tsdown", // builds src/cli.ts -> dist/cli.js
    // After the build so a cleaning build tool (tsdown `clean: true` etc.)
    // cannot wipe the generated file; `prepack` works too.
    "postbuild": "politty generate-shim --entry ./cli.js",
  },
}
```

`--entry` is the specifier the shim imports, relative to the shim file. The output path and the program name for the cache directory come from `package.json`: the output path is the `bin` path (that is where the executable must live) and the program name is the `bin` name. `--entry` itself can also be omitted — the generator then picks the first of `./cli.js`, `./cli.mjs`, `./index.js`, `./index.mjs` that exists next to the shim. Override the derived values with `--out` and `--program` when needed.

The shim imports `enableCompileCache` from the `compile-cache` subpath of **the politty package whose `politty` bin you ran** — you never write that specifier yourself. Running that bin means the package is installed in your project, so what it writes resolves from the shim it puts there. Pass `--compile-cache-specifier` if the helper reaches your code some other way, such as a re-export from your own package.

For a package with multiple `bin` entries, pass `--entry` once per bin — they pair with the `bin` entries in declaration order (or with `--out` paths of the same count):

```jsonc
{
  "bin": { "tool-a": "./dist/bin-a.js", "tool-b": "./dist/bin-b.js" },
  "scripts": {
    "postbuild": "politty generate-shim --entry ./cli-a.js --entry ./cli-b.js",
  },
}
```

A few behaviors to know about: the generator refuses to overwrite an existing file it did not generate — so if your `bin` still points at the real CLI entry, it fails loudly instead of clobbering the build output (point `bin` at a separate shim path like `dist/bin.js`). The shim is an ES module, so use a `.js` output only in a `"type": "module"` package, and `.mjs` otherwise. When an explicit `--out` cannot be matched to a `bin` entry, the fallback program name is used with a warning (pass `--program` to pick one explicitly). And the generated shim degrades gracefully: if the `compile-cache` subpath is not resolvable at runtime — for example in a fully bundled CLI — it starts your entry without the cache instead of failing. Because that degradation is silent, keep the shim regenerated by your build rather than editing it by hand: a stale specifier costs you the cache without any error.

Writing the shim by hand is equally fine. Replace the placeholder below with the politty package your CLI depends on — the `compile-cache` subpath is exported from all of them, and only a package your own `package.json` declares resolves from your shim:

```typescript
#!/usr/bin/env node
// bin.ts — keep this file's static imports minimal
import { enableCompileCache } from "<your-politty-package>/compile-cache";

enableCompileCache("my-cli");
await import("./cli.js"); // defineCommand + runMain live here
```

The `compile-cache` subpath is dependency-free (Node builtins only), never throws, and no-ops on runtimes without compile-cache support, so the shim adds no meaningful cold-start cost.

## Error Handling

Errors thrown within `run` are caught by `runMain` and output to stderr. The `cleanup` hook is executed with the `error` object.

```typescript
const command = defineCommand({
  run: () => {
    throw new Error("Something broke!");
  },
  cleanup: ({ error }) => {
    if (error) {
      // Perform emergency cleanup or logging
    }
  },
});
```

### Reading global options when argument validation fails

Global `effect`s run only after every argument validates, so an unknown flag or an invalid value ends the run before any of them has run. The global `cleanup` hook receives the validated global values as `globalArgs`, so an error can still be rendered the way the user asked for:

```typescript
runMain(cli, {
  displayErrors: false,
  globalArgs: z.strictObject({ json: arg(z.boolean().default(false), { env: "MY_CLI_JSON" }) }),
  cleanup: ({ error, globalArgs }) => {
    if (!error) return;
    // `my-cli list --json --bogus` => globalArgs.json === true
    console.error(globalArgs?.json ? JSON.stringify({ error: error.message }) : error.message);
  },
});
```

Unknown flags are ignored, and a value that fails its own validation (`--json=yes`) is dropped, so the schema's default applies where it defines one. `globalArgs?.$source?.("json")` returns `"cli"`, `"env"`, `"prompt"` or `"default"`. A value filled in by the `prompt` resolver is included and reports `"prompt"`. `globalArgs` is `undefined` when the run did not fail before the global effects, when a required global value is missing, when recovering the values throws, or when `setup` failed (it runs before any argument is parsed).
