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
        name: arg(z.string(), { positional: true })
      }),
      run: (args) => console.log(`Hello ${args.name}`)
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
    args: z.object({ age: arg(z.number()) })
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
  debug: true
});
```

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
  }
});
```
