import { describe, expect, it, vi } from "vitest";
import { lazy } from "../lazy.js";
import type { AnyCommand } from "../types.js";
import { findCommandPath } from "./command-path.js";
import { defineCommand } from "./command.js";

const leaf = (name: string, aliases?: string[]) =>
  defineCommand({ name, ...(aliases ? { aliases } : {}), run: () => {} });

describe("findCommandPath", () => {
  it("returns an empty path when the target is the root", async () => {
    const root = defineCommand({ name: "cli" });

    expect(await findCommandPath(root, root)).toEqual([]);
  });

  it("returns the registered key of a direct subcommand", async () => {
    const deploy = leaf("deploy");
    const root = defineCommand({ name: "cli", subCommands: { deploy } });

    expect(await findCommandPath(root, deploy)).toEqual(["deploy"]);
  });

  it("returns the keys from the root through every parent", async () => {
    const deploy = leaf("deploy");
    const ops = defineCommand({ name: "ops", subCommands: { deploy } });
    const root = defineCommand({ name: "cli", subCommands: { ops } });

    expect(await findCommandPath(root, deploy)).toEqual(["ops", "deploy"]);
  });

  it("uses the registered key even when it differs from the command name", async () => {
    const deploy = leaf("deploy-impl");
    const root = defineCommand({ name: "cli", subCommands: { ship: deploy } });

    expect(await findCommandPath(root, deploy)).toEqual(["ship"]);
  });

  it("does not use an alias in the path", async () => {
    const deploy = leaf("deploy", ["d"]);
    const root = defineCommand({ name: "cli", subCommands: { deploy } });

    expect(await findCommandPath(root, deploy)).toEqual(["deploy"]);
  });

  it("returns undefined when the target is not in the tree", async () => {
    const root = defineCommand({ name: "cli", subCommands: { other: leaf("other") } });

    expect(await findCommandPath(root, leaf("deploy"))).toBeUndefined();
  });

  it("finds a command that a lazy subcommand loads", async () => {
    const deploy = leaf("deploy");
    const root = defineCommand({
      name: "cli",
      subCommands: { deploy: lazy(leaf("deploy"), async () => deploy) },
    });

    expect(await findCommandPath(root, deploy)).toEqual(["deploy"]);
  });

  it("finds the metadata command of a lazy subcommand", async () => {
    const meta = leaf("deploy");
    const root = defineCommand({
      name: "cli",
      subCommands: { deploy: lazy(meta, async () => leaf("deploy")) },
    });

    expect(await findCommandPath(root, meta)).toEqual(["deploy"]);
  });

  it("finds a command below a lazy group", async () => {
    const deploy = leaf("deploy");
    const ops = defineCommand({ name: "ops", subCommands: { deploy } });
    const root = defineCommand({
      name: "cli",
      subCommands: { ops: lazy(defineCommand({ name: "ops" }), async () => ops) },
    });

    expect(await findCommandPath(root, deploy)).toEqual(["ops", "deploy"]);
  });

  it("finds a command that an async function subcommand returns", async () => {
    const deploy = leaf("deploy");
    const root = defineCommand({
      name: "cli",
      subCommands: { deploy: async () => deploy },
    });

    expect(await findCommandPath(root, deploy)).toEqual(["deploy"]);
  });

  it("skips a lazy subcommand whose loader throws", async () => {
    const deploy = leaf("deploy");
    const root = defineCommand({
      name: "cli",
      subCommands: {
        broken: lazy(leaf("broken"), async () => {
          throw new Error("load failed");
        }),
        deploy,
      },
    });

    expect(await findCommandPath(root, deploy)).toEqual(["deploy"]);
  });

  it("returns the first registered path when a command has several parents", async () => {
    const deploy = leaf("deploy");
    const first = defineCommand({ name: "first", subCommands: { deploy } });
    const second = defineCommand({ name: "second", subCommands: { deploy } });
    const root = defineCommand({ name: "cli", subCommands: { first, second } });

    expect(await findCommandPath(root, deploy)).toEqual(["first", "deploy"]);
  });

  it("terminates on a tree that contains a cycle", async () => {
    const loop: AnyCommand = defineCommand({ name: "loop", subCommands: {} });
    (loop.subCommands as Record<string, AnyCommand>)["again"] = loop;
    const root = defineCommand({ name: "cli", subCommands: { loop } });

    expect(await findCommandPath(root, leaf("deploy"))).toBeUndefined();
  });
});

describe("findCommandPath loading", () => {
  it("does not load a lazy sibling when the target is a registered command", async () => {
    const load = vi.fn(async () => leaf("heavy"));
    const deploy = leaf("deploy");
    const root = defineCommand({
      name: "cli",
      subCommands: { heavy: lazy(leaf("heavy"), load), deploy },
    });

    expect(await findCommandPath(root, deploy)).toEqual(["deploy"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("finds the metadata command of a lazy subcommand without loading it", async () => {
    const load = vi.fn(async () => leaf("deploy"));
    const meta = leaf("deploy");
    const root = defineCommand({ name: "cli", subCommands: { deploy: lazy(meta, load) } });

    expect(await findCommandPath(root, meta)).toEqual(["deploy"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("finds a command in the metadata of a lazy group without loading the group", async () => {
    const load = vi.fn(async () => defineCommand({ name: "ops" }));
    const deploy = leaf("deploy");
    const group = defineCommand({ name: "ops", subCommands: { deploy } });
    const root = defineCommand({ name: "cli", subCommands: { ops: lazy(group, load) } });

    expect(await findCommandPath(root, deploy)).toEqual(["ops", "deploy"]);
    expect(load).not.toHaveBeenCalled();
  });

  it("loads the lazy subcommand named like the target before the others", async () => {
    const loadOther = vi.fn(async () => leaf("other"));
    const deploy = leaf("deploy");
    const root = defineCommand({
      name: "cli",
      subCommands: {
        other: lazy(leaf("other"), loadOther),
        deploy: lazy(leaf("deploy"), async () => deploy),
      },
    });

    expect(await findCommandPath(root, deploy)).toEqual(["deploy"]);
    expect(loadOther).not.toHaveBeenCalled();
  });
});
