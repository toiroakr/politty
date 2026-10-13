import { describe, expect, it } from "vitest";
import { z } from "zod";
import { arg } from "../core/arg-registry.js";
import { defineCommand } from "../core/command.js";
import { lazy } from "../lazy.js";
import { collectAllCommands } from "./doc-generator.js";

describe("optional package documentation", () => {
  it("collects nested command and argument metadata without loading optional packages", async () => {
    let loads = 0;
    const meta = defineCommand({
      name: "studio",
      description: "Browse data",
      requires: [
        {
          name: "@politty-test/missing-studio",
          install: "npm install -D @politty-test/missing-studio",
        },
      ],
      args: z.object({ file: arg(z.string(), { positional: true }) }),
      subCommands: {
        view: lazy(defineCommand({ name: "view", description: "View data" }), async () => {
          loads++;
          throw new Error("child loader must not run during documentation");
        }),
      },
    });
    const command = defineCommand({
      name: "cli",
      subCommands: {
        studio: lazy(meta, async () => {
          loads++;
          throw new Error("loader must not run during documentation");
        }),
      },
    });
    const commands = await collectAllCommands(command);
    expect([...commands.keys()]).toEqual(["", "studio", "studio view"]);
    expect(commands.get("studio")?.positionalArgs.map((field) => field.name)).toEqual(["file"]);
    expect(commands.get("studio view")?.description).toBe("View data");
    expect(loads).toBe(0);
  });
});
