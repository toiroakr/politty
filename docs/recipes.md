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

Node.js (>= 22.8.0) can persist compiled V8 bytecode to disk so warm starts skip recompilation. `runMain` enables this automatically: the cache lives in `${XDG_CACHE_HOME:-$HOME/.cache}/<command name>/node-compile-cache` (shared with the shell-completion workers), the `NODE_COMPILE_CACHE` environment variable takes precedence, and older runtimes are a silent no-op.

```typescript
// Opt out, or pin a custom directory:
runMain(command, { compileCache: false });
runMain(command, { compileCache: "/custom/cache-dir" });
```

The automatic enablement only covers modules imported _after_ `runMain` starts — for example [`lazy()` subcommands](./advanced-features.md). ESM static imports are compiled during the link phase, before any code runs, so your entry file's import graph (politty, zod, your commands) can never hit a cache enabled that late. To cache the whole CLI, make your bin a minimal shim that enables the cache first and loads the real entry with a dynamic import.

The easiest way is to let the `politty` CLI generate the shim as part of your build, so it never has to live in source:

```jsonc
// package.json
{
  "bin": { "my-cli": "./dist/bin.js" },
  "scripts": {
    "build": "tsdown",
    // After the build so a cleaning build tool (tsdown `clean: true` etc.)
    // cannot wipe the generated file; `prepack` works too.
    "postbuild": "politty generate-shim --entry ./cli.js --out dist/bin.js",
  },
}
```

`generate-shim` writes an executable ESM shim to `--out` that imports `--entry` (a specifier relative to the shim file). The program name for the cache directory defaults to the first `bin` name in your `package.json` (override with `--program`). The shim is an ES module: use a `.js` output only in a `"type": "module"` package, and `.mjs` otherwise.

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
