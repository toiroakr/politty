import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { GlobalCleanupContext } from "../types.js";
import { arg } from "./arg-registry.js";
import { defineCommand } from "./command.js";
import { runMain } from "./runner.js";

const useArgv = (argv: string[]) => {
  const originalArgv = process.argv;
  process.argv = argv;
  return {
    [Symbol.dispose]() {
      process.argv = originalArgv;
    },
  };
};

async function runAndCaptureCleanup(
  argv: string[],
  build: (cleanup: (context: GlobalCleanupContext) => void) => Parameters<typeof runMain>,
): Promise<GlobalCleanupContext> {
  using _argv = useArgv(["node", "test", ...argv]);
  using _exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  using _error = vi.spyOn(console, "error").mockImplementation(() => {});
  using _log = vi.spyOn(console, "log").mockImplementation(() => {});
  let captured: GlobalCleanupContext | undefined;
  await runMain(...build((context) => (captured = context)));
  if (!captured) throw new Error("cleanup was not called");
  return captured;
}

const globalArgs = z.strictObject({
  json: arg(z.boolean().default(false), { env: "POLITTY_TEST_JSON" }),
});

describe("cleanup context globalArgs", () => {
  afterEach(() => {
    delete process.env.POLITTY_TEST_JSON;
  });

  it("carries the global value given before a local validation failure", async () => {
    const cmd = defineCommand({ name: "test", args: z.strictObject({}), run: () => {} });

    const context = await runAndCaptureCleanup(["--json", "--bogus"], (cleanup) => [
      cmd,
      { globalArgs, cleanup },
    ]);

    expect(context.error).toBeDefined();
    expect(context.globalArgs?.json).toBe(true);
  });

  it("carries the global value when a command group rejects an unknown flag", async () => {
    const sub = defineCommand({ name: "sub", run: () => {} });
    const cmd = defineCommand({ name: "test", subCommands: { sub } });

    const context = await runAndCaptureCleanup(["--json", "--bogus"], (cleanup) => [
      cmd,
      { globalArgs, cleanup },
    ]);

    expect(context.error).toBeDefined();
    expect(context.globalArgs?.json).toBe(true);
  });

  it("carries the global value given after the subcommand name", async () => {
    const sub = defineCommand({ name: "sub", args: z.strictObject({}), run: () => {} });
    const cmd = defineCommand({ name: "test", subCommands: { sub } });

    const context = await runAndCaptureCleanup(["sub", "--json", "--bogus"], (cleanup) => [
      cmd,
      { globalArgs, cleanup },
    ]);

    expect(context.globalArgs?.json).toBe(true);
  });

  it("carries the value read from the environment variable", async () => {
    process.env.POLITTY_TEST_JSON = "1";
    const cmd = defineCommand({ name: "test", args: z.strictObject({}), run: () => {} });

    const context = await runAndCaptureCleanup(["--bogus"], (cleanup) => [
      cmd,
      { globalArgs, cleanup },
    ]);

    expect(context.globalArgs?.json).toBe(true);
  });

  it("reports where each value came from through $source", async () => {
    process.env.POLITTY_TEST_JSON = "1";
    const cmd = defineCommand({ name: "test", args: z.strictObject({}), run: () => {} });

    const context = await runAndCaptureCleanup(["--bogus"], (cleanup) => [
      cmd,
      { globalArgs, cleanup },
    ]);

    expect((context.globalArgs as { $source(name: string): string }).$source("json")).toBe("env");
  });

  it("falls back to the default for a value that fails its own validation", async () => {
    const cmd = defineCommand({ name: "test", args: z.strictObject({}), run: () => {} });

    const context = await runAndCaptureCleanup(["--json=yes"], (cleanup) => [
      cmd,
      { globalArgs, cleanup },
    ]);

    expect(context.error).toBeDefined();
    expect(context.globalArgs?.json).toBe(false);
  });

  it("keeps the other global values when one value is invalid", async () => {
    const twoGlobals = z.strictObject({
      json: arg(z.boolean().default(false)),
      verbose: arg(z.boolean().default(false)),
    });
    const cmd = defineCommand({ name: "test", run: () => {} });

    const context = await runAndCaptureCleanup(["--json=yes", "--verbose"], (cleanup) => [
      cmd,
      { globalArgs: twoGlobals, cleanup },
    ]);

    expect(context.globalArgs).toMatchObject({ json: false, verbose: true });
  });

  it("is undefined when a required global value is missing", async () => {
    const required = z.strictObject({ profile: arg(z.string()) });
    const cmd = defineCommand({ name: "test", args: z.strictObject({}), run: () => {} });

    const context = await runAndCaptureCleanup(["--bogus"], (cleanup) => [
      cmd,
      { globalArgs: required, cleanup },
    ]);

    expect(context.error).toBeDefined();
    expect(context.globalArgs).toBeUndefined();
  });

  it("is undefined when the command succeeds", async () => {
    const cmd = defineCommand({ name: "test", run: () => {} });

    const context = await runAndCaptureCleanup(["--json"], (cleanup) => [
      cmd,
      { globalArgs, cleanup },
    ]);

    expect(context.error).toBeUndefined();
    expect(context.globalArgs).toBeUndefined();
  });

  it("is undefined when no globalArgs schema is configured", async () => {
    const cmd = defineCommand({ name: "test", args: z.strictObject({}), run: () => {} });

    const context = await runAndCaptureCleanup(["--bogus"], (cleanup) => [cmd, { cleanup }]);

    expect(context.globalArgs).toBeUndefined();
  });
});
