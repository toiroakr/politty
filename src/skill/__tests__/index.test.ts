import { describe, expect, it } from "vitest";
import { defineCommand } from "../../core/command.js";
import { withSkillCommand } from "../index.js";

describe("withSkillCommand", () => {
  it("should add skills subcommand to a command", () => {
    const base = defineCommand({
      name: "my-cli",
      description: "Test CLI",
    });

    const wrapped = withSkillCommand(base, { sourceDir: "/tmp/nonexistent" });

    expect(wrapped.subCommands).toBeDefined();
    expect(wrapped.subCommands!.skills).toBeDefined();
  });

  it("should preserve existing subcommands", () => {
    const existing = defineCommand({ name: "run", description: "Run" });
    const base = defineCommand({
      name: "my-cli",
      description: "Test CLI",
      subCommands: { run: existing },
    });

    const wrapped = withSkillCommand(base, { sourceDir: "/tmp/nonexistent" });

    expect(wrapped.subCommands!.run).toBe(existing);
    expect(wrapped.subCommands!.skills).toBeDefined();
  });

  it("should not mutate the original command", () => {
    const base = defineCommand({
      name: "my-cli",
      description: "Test CLI",
    });

    const wrapped = withSkillCommand(base, { sourceDir: "/tmp/nonexistent" });

    expect(wrapped).not.toBe(base);
    expect(base.subCommands).toBeUndefined();
  });
});
