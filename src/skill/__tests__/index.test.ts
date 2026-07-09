import { describe, expect, expectTypeOf, it } from "vitest";
import { defineCommand } from "../../core/command.js";
import type { AnyCommand } from "../../types.js";
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

  it("should type subCommands.skills as AnyCommand without a cast", () => {
    const base = defineCommand({
      name: "my-cli",
      description: "Test CLI",
    });

    const wrapped = withSkillCommand(base, opts);

    // Compile-time assertion: `subCommands` is no longer optional, and
    // `skills` is typed directly — no `subCommands?.skills as AnyCommand`
    // cast required by consumers.
    expectTypeOf(wrapped.subCommands).not.toBeNullable();
    expectTypeOf(wrapped.subCommands.skills).toEqualTypeOf<AnyCommand>();
  });

  it("should disable the 'install'/'uninstall' aliases via commandMap", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    const wrapped = withSkillCommand(base, {
      ...opts,
      commandMap: { add: ["add"], remove: ["remove"] },
    });

    const skillsSubCommands = wrapped.subCommands.skills.subCommands!;
    expect((skillsSubCommands.add as AnyCommand).aliases).toBeUndefined();
    expect((skillsSubCommands.remove as AnyCommand).aliases).toBeUndefined();
  });

  it("should rename the add/remove subcommands and dispatch under the new keys via commandMap", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    const wrapped = withSkillCommand(base, {
      ...opts,
      commandMap: { add: ["setup", "add"], remove: ["teardown"] },
    });

    const skillsSubCommands = wrapped.subCommands.skills.subCommands!;
    expect(Object.hasOwn(skillsSubCommands, "setup")).toBe(true);
    expect(Object.hasOwn(skillsSubCommands, "add")).toBe(false);
    expect(Object.hasOwn(skillsSubCommands, "teardown")).toBe(true);
    expect((skillsSubCommands.setup as AnyCommand).name).toBe("setup");
    expect((skillsSubCommands.setup as AnyCommand).aliases).toEqual(["add"]);
  });

  it("should throw when commandMap produces a duplicate subcommand name", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    expect(() => withSkillCommand(base, { ...opts, commandMap: { add: ["list"] } })).toThrow(
      /duplicate subcommand name\/alias "list"/,
    );
  });

  it("should throw when a commandMap alias collides with another subcommand's primary name", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    expect(() => withSkillCommand(base, { ...opts, commandMap: { add: ["add", "list"] } })).toThrow(
      /duplicate subcommand name\/alias "list"/,
    );
  });

  it("should throw when add and remove commandMap aliases collide with each other", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    expect(() =>
      withSkillCommand(base, {
        ...opts,
        commandMap: { add: ["add", "manage"], remove: ["remove", "manage"] },
      }),
    ).toThrow(/duplicate subcommand name\/alias "manage"/);
  });

  it("should throw when a commandMap entry is an empty string", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    expect(() => withSkillCommand(base, { ...opts, commandMap: { add: ["add", ""] } })).toThrow(
      /commandMap entry "" is invalid/,
    );
  });

  it("should throw when a commandMap entry starts with a dash", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    expect(() =>
      withSkillCommand(base, { ...opts, commandMap: { remove: ["remove", "-rm"] } }),
    ).toThrow(/commandMap entry "-rm" is invalid/);
  });

  it("should throw when a commandMap entry contains whitespace", () => {
    const base = defineCommand({ name: "my-cli", description: "Test CLI" });

    expect(() => withSkillCommand(base, { ...opts, commandMap: { add: ["add install"] } })).toThrow(
      /commandMap entry "add install" is invalid/,
    );
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
