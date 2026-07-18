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

### Testing Validation Errors

You can verify that the expected exit code (usually 1) is returned when invalid arguments are passed.

```typescript
it("should fail validation", async () => {
  // Suppress error output
  vi.spyOn(console, "error").mockImplementation(() => {});

  const command = defineCommand({
    name: "test",
    args: z.object({ age: arg(z.number()) }),
  });

  const result = await runCommand(command, ["--age", "not-a-number"]);

  expect(result.exitCode).toBe(1);
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

## Runtime Configuration

### Signal Handling (Ctrl+C)

When using `runMain`, exit signals (SIGINT, SIGTERM) are automatically handled and the `cleanup` hook is executed. This ensures that `cleanup` is called even when the user interrupts the process.

> **Note:** `runCommand` is intended for testing purposes and does not handle signals. Use `runMain` in production environments.

### Debug Mode

Enable debug mode to display complete stack traces instead of just error messages when errors occur.

```typescript
runMain(command, {
  debug: true,
});
```

### Faster Startup (Compile Cache)

Node.js (>= 22.8.0) can persist compiled V8 bytecode to disk so warm starts skip recompilation. `runMain` enables this automatically: the cache lives in `${XDG_CACHE_HOME:-$HOME/.cache}/<command name>/node-compile-cache` (shared with the shell-completion workers), the `NODE_COMPILE_CACHE` environment variable takes precedence (Node.js honors it at process startup, so it applies even with `compileCache: false`), and older runtimes are a silent no-op.

```typescript
// Opt out, or pin a custom directory:
runMain(command, { compileCache: false });
runMain(command, { compileCache: "/custom/cache-dir" });
```

The automatic enablement only covers modules imported _after_ `runMain` starts — for example [`lazy()` subcommands](./advanced-features.md); your entry file's static import graph (politty, zod, your commands) is compiled before any code runs, so it never hits a cache enabled that late (the `politty/compile-cache` JSDoc explains why). To cache the whole CLI, make your bin a minimal shim that enables the cache first and loads the real entry with a dynamic import.

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

`--entry` is the specifier the shim imports, relative to the shim file. Everything else is derived from `package.json`: the output path is the `bin` path (that is where the executable must live) and the program name for the cache directory is the `bin` name. `--entry` itself can also be omitted — the generator then picks the first of `./cli.js`, `./cli.mjs`, `./index.js`, `./index.mjs` that exists next to the shim. Override the derived values with `--out` and `--program` when needed.

For a package with multiple `bin` entries, pass `--entry` once per bin — they pair with the `bin` entries in declaration order (or with `--out` paths of the same count):

```jsonc
{
  "bin": { "tool-a": "./dist/bin-a.js", "tool-b": "./dist/bin-b.js" },
  "scripts": {
    "postbuild": "politty generate-shim --entry ./cli-a.js --entry ./cli-b.js",
  },
}
```

A few behaviors to know about: the generator refuses to overwrite an existing file it did not generate — so if your `bin` still points at the real CLI entry, it fails loudly instead of clobbering the build output (point `bin` at a separate shim path like `dist/bin.js`). The shim is an ES module, so use a `.js` output only in a `"type": "module"` package, and `.mjs` otherwise. When an explicit `--out` cannot be matched to a `bin` entry, the fallback program name is used with a warning (pass `--program` to pick one explicitly). And the generated shim degrades gracefully: if `politty` is not resolvable at runtime — for example in a fully bundled CLI — it starts your entry without the cache instead of failing.

Writing the shim by hand is equally fine:

```typescript
#!/usr/bin/env node
// bin.ts — keep this file's static imports minimal
import { enableCompileCache } from "politty/compile-cache";

enableCompileCache("my-cli");
await import("./cli.js"); // defineCommand + runMain live here
```

`politty/compile-cache` is dependency-free (Node builtins only), never throws, and no-ops on runtimes without compile-cache support, so the shim adds no meaningful cold-start cost.

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
