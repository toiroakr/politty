import { describe, expect, it } from "vitest";
import { command, initCommand } from "../../playground/23-global-options-index-markers/index.js";
import { createCommandRenderer } from "./default-renderers.js";
import { buildCommandInfo } from "./doc-generator.js";
import { createCommandMd, createLayoutMd } from "./md-tag.js";

describe("createCommandMd", () => {
  it("exposes generated sections as getters and composes a block", async () => {
    const info = await buildCommandInfo(initCommand, "project-cli", ["init"]);
    const md = createCommandMd(info, { baseHeadingLevel: 2 });

    expect(md.h(1)).toBe("## init");
    expect(md.h(2, "Notes")).toBe("### Notes");
    expect(md.usage).toBe("**Usage**\n\n```\nproject-cli init [options] <name>\n```");
    expect(md.arguments).toContain("**Arguments**");
    expect(md.arguments).toContain("`name`");
    expect(md.options).toContain("**Options**");
    expect(md.options).toContain("--template");

    const block = md`
      ${md.h(1)}

      ${md.description}

      > custom note

      ${md.usage}

      ${md.options}
    `;
    expect(block).toBe(
      [
        "## init",
        "",
        "Initialize a new project",
        "",
        "> custom note",
        "",
        "**Usage**",
        "",
        "```",
        "project-cli init [options] <name>",
        "```",
        "",
        "**Options**",
        "",
        md.options.split("\n").slice(2).join("\n"),
      ].join("\n"),
    );
  });

  it("returns empty string for sections that do not apply (no gap)", async () => {
    const info = await buildCommandInfo(command, "project-cli", []);
    const md = createCommandMd(info, { baseHeadingLevel: 1 });
    // root command has no positional args
    expect(md.arguments).toBe("");

    const block = md`
      ${md.h(1)}
      ${md.arguments}
      ${md.subcommands}
    `;
    // no triple blank line from the empty arguments interpolation
    expect(block).not.toContain("\n\n\n");
    expect(block.startsWith("# project-cli")).toBe(true);
  });
});

describe("createLayoutMd", () => {
  it("exposes commands(), globalOptions and index", () => {
    const md = createLayoutMd({
      commands: () => "CMD_BLOCKS",
      globalOptions: "GLOBAL_TABLE",
      index: "INDEX",
    });

    const out = md`
      # Title

      ## Global Options
      ${md.globalOptions}

      ## Command Reference
      ${md.index}

      ${md.commands()}
    `;
    expect(out).toBe(
      "# Title\n\n## Global Options\nGLOBAL_TABLE\n\n## Command Reference\nINDEX\n\nCMD_BLOCKS",
    );
  });

  it("defaults globalOptions and index to empty strings", () => {
    const md = createLayoutMd({ commands: () => "X" });
    expect(md.globalOptions).toBe("");
    expect(md.index).toBe("");
  });
});

describe("createCommandMd.sections", () => {
  it("no-arg sections() equals the default block (createCommandRenderer)", async () => {
    const info = await buildCommandInfo(initCommand, "project-cli", ["init"]);
    const headingLevel = 2;
    const renderer = createCommandRenderer({ headingLevel });
    // The renderer adds (depth - 1) to headingLevel; createCommandMd takes the
    // already-effective base. Mirror golden-test's per-command wiring.
    const md = createCommandMd(info, { baseHeadingLevel: headingLevel + (info.depth - 1) });
    expect(md.sections()).toBe(renderer(info));
  });

  it("replace swaps a section's content, keeping position", async () => {
    const info = await buildCommandInfo(initCommand, "project-cli", ["init"]);
    const md = createCommandMd(info, { baseHeadingLevel: 2 });
    const out = md.sections({ replace: { options: "CUSTOM_OPTIONS" } });
    expect(out).toContain("CUSTOM_OPTIONS");
    expect(out).not.toContain("--template"); // original options table gone
    // position preserved: options still between usage and (no globalOptionsLink here)
    expect(out.indexOf("CUSTOM_OPTIONS")).toBeGreaterThan(out.indexOf("**Usage**"));
  });

  it("insertAfter / insertBefore place content relative to an anchor", async () => {
    const info = await buildCommandInfo(initCommand, "project-cli", ["init"]);
    const md = createCommandMd(info, { baseHeadingLevel: 2 });
    const out = md.sections({
      insertAfter: { usage: "AFTER_USAGE" },
      insertBefore: { options: "BEFORE_OPTIONS" },
    });
    expect(out.indexOf("AFTER_USAGE")).toBeGreaterThan(out.indexOf("**Usage**"));
    expect(out.indexOf("BEFORE_OPTIONS")).toBeLessThan(out.indexOf("--template"));
    expect(out.indexOf("AFTER_USAGE")).toBeLessThan(out.indexOf("BEFORE_OPTIONS"));
  });

  it("insertAfter accepts an array of items", async () => {
    const info = await buildCommandInfo(initCommand, "project-cli", ["init"]);
    const md = createCommandMd(info, { baseHeadingLevel: 2 });
    const out = md.sections({ insertAfter: { usage: ["ONE", "TWO"] } });
    expect(out.indexOf("ONE")).toBeLessThan(out.indexOf("TWO"));
    expect(out.indexOf("ONE")).toBeGreaterThan(out.indexOf("**Usage**"));
  });

  it("remove drops sections; prepend/append wrap the block", async () => {
    const info = await buildCommandInfo(initCommand, "project-cli", ["init"]);
    const md = createCommandMd(info, { baseHeadingLevel: 2 });
    const out = md.sections({ remove: ["heading"], prepend: "TOP", append: "BOTTOM" });
    expect(out).not.toContain("## init");
    expect(out.startsWith("TOP")).toBe(true);
    expect(out.endsWith("BOTTOM")).toBe(true);
  });

  it("throws on an unknown section name", async () => {
    const info = await buildCommandInfo(initCommand, "project-cli", ["init"]);
    const md = createCommandMd(info, { baseHeadingLevel: 2 });
    // @ts-expect-error unknown section
    expect(() => md.sections({ replace: { optionz: "x" } })).toThrow(/Unknown section/);
  });
});
