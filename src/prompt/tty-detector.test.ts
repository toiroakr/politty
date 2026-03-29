import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isInteractive } from "./tty-detector.js";

describe("isInteractive", () => {
  const originalStdin = process.stdin.isTTY;
  const originalStdout = process.stdout.isTTY;

  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", { value: originalStdin, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: originalStdout, configurable: true });
    vi.unstubAllEnvs();
  });

  function setTTY(stdin: boolean, stdout: boolean): void {
    Object.defineProperty(process.stdin, "isTTY", { value: stdin, configurable: true });
    Object.defineProperty(process.stdout, "isTTY", { value: stdout, configurable: true });
  }

  it("returns true when stdin and stdout are TTY and no CI", () => {
    setTTY(true, true);
    vi.stubEnv("CI", "");
    delete process.env.CI;
    delete process.env.POLITTY_NO_PROMPT;
    expect(isInteractive()).toBe(true);
  });

  it("returns false when stdin is not TTY", () => {
    setTTY(false, true);
    expect(isInteractive()).toBe(false);
  });

  it("returns false when stdout is not TTY", () => {
    setTTY(true, false);
    expect(isInteractive()).toBe(false);
  });

  it("returns false when CI env is set", () => {
    setTTY(true, true);
    vi.stubEnv("CI", "true");
    expect(isInteractive()).toBe(false);
  });

  it("returns false when POLITTY_NO_PROMPT is set", () => {
    setTTY(true, true);
    delete process.env.CI;
    vi.stubEnv("POLITTY_NO_PROMPT", "1");
    expect(isInteractive()).toBe(false);
  });
});
