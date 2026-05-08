import { describe, expect, it } from "vitest";
import { defineCommand } from "../../core/command.js";
import { withSkillCommand } from "../index.js";

const opts = { sourceDir: "/tmp/nonexistent", package: "@my-agent/skills" };

describe("withSkillCommand", () => {
  it("should add skills subcommand to a command", () => {
    const base = defineCommand({
      name: "my-cli",
      description: "Test CLI",
    });

    const wrapped = withSkillCommand(base, opts);

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

    const wrapped = withSkillCommand(base, opts);

    expect(wrapped.subCommands!.run).toBe(existing);
    expect(wrapped.subCommands!.skills).toBeDefined();
  });

  it("should not mutate the original command", () => {
    const base = defineCommand({
      name: "my-cli",
      description: "Test CLI",
    });

    const wrapped = withSkillCommand(base, opts);

    expect(wrapped).not.toBe(base);
    expect(base.subCommands).toBeUndefined();
  });

  it("should throw if the command already defines a 'skills' subcommand", () => {
    const collider = defineCommand({ name: "skills", description: "User-defined" });
    const base = defineCommand({
      name: "my-cli",
      description: "Test CLI",
      subCommands: { skills: collider },
    });

    expect(() => withSkillCommand(base, opts)).toThrow(/already defines a "skills"/);
  });

  it("should append a default skills hint to the root description", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    const wrapped = withSkillCommand(base, opts);

    // The append makes `--help` advertise the skills subcommand.
    expect(wrapped.description).toMatch(/my-cli skills <add\|sync\|remove\|list>/);
  });

  it("should leave the description untouched when descriptionAppend is false", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    const wrapped = withSkillCommand(base, { ...opts, descriptionAppend: false });

    expect(wrapped.description).toBe("Test CLI");
  });

  it("should append a custom string when descriptionAppend is provided", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    const wrapped = withSkillCommand(base, { ...opts, descriptionAppend: "(custom hint)" });

    expect(wrapped.description).toBe("Test CLI\n\n(custom hint)");
  });

  it("should separate the host description and the hint with a blank line", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    const wrapped = withSkillCommand(base, opts);

    // A single space would run the hint into the host description when the
    // host description has no trailing period (a common pattern). The blank
    // line keeps `--help` legible.
    expect(wrapped.description).toMatch(/^Test CLI\n\nManage agent skills/);
  });

  it("should not duplicate the hint when re-wrapping a command", () => {
    // A double wrap would be a configuration bug, but tests / playgrounds
    // sometimes trigger it. Append-once keeps the help output clean.
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });
    const once = withSkillCommand(base, opts);
    const twice = withSkillCommand(
      defineCommand({ name: "my-cli", description: once.description ?? "" }),
      opts,
    );

    const occurrences = (twice.description ?? "").split("Manage agent skills").length - 1;
    expect(occurrences).toBe(1);
  });

  it("should set the description to the hint when no description is provided", () => {
    const base = defineCommand({ name: "my-cli" });

    const wrapped = withSkillCommand(base, opts);

    expect(wrapped.description).toMatch(/Manage agent skills/);
  });
});
