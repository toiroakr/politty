import { describe, expect, it } from "vitest";
import { defineCommand } from "./core/command.js";
import { isLazyCommand, lazy } from "./lazy.js";

describe("lazy", () => {
  const meta = defineCommand({
    name: "deploy",
    description: "Deploy the application",
  });

  const fullCommand = defineCommand({
    name: "deploy",
    description: "Deploy the application",
    run: () => "deployed",
  });

  it("should create a LazyCommand with meta and load", () => {
    const cmd = lazy(meta, async () => fullCommand);

    expect(cmd.meta).toBe(meta);
    expect(cmd.__politty_lazy__).toBe(true);
    expect(typeof cmd.load).toBe("function");
  });

  it("should resolve load() to the full command", async () => {
    const cmd = lazy(meta, async () => fullCommand);

    const resolved = await cmd.load();

    expect(resolved).toBe(fullCommand);
    expect(resolved.run).toBeDefined();
  });
});

describe("isLazyCommand", () => {
  it("should return true for LazyCommand", () => {
    const meta = defineCommand({ name: "test" });
    const cmd = lazy(meta, async () => meta);

    expect(isLazyCommand(cmd)).toBe(true);
  });

  it("should return false for plain command", () => {
    const cmd = defineCommand({ name: "test" });

    expect(isLazyCommand(cmd)).toBe(false);
  });

  it("should return false for async function", () => {
    const fn = async () => defineCommand({ name: "test" });

    expect(isLazyCommand(fn)).toBe(false);
  });

  it("should return false for null and undefined", () => {
    expect(isLazyCommand(null)).toBe(false);
    expect(isLazyCommand(undefined)).toBe(false);
  });

  it("should return false for non-object values", () => {
    expect(isLazyCommand("string")).toBe(false);
    expect(isLazyCommand(42)).toBe(false);
    expect(isLazyCommand(true)).toBe(false);
  });
});
