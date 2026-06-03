import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generateDoc } from "../../politty/src/docs/index.js";
import { migrate } from "../src/index.js";
import { verifyMigration } from "../src/verify.js";
import { initCommand } from "./fixtures/integration/command.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(here, p), "utf-8");

describe("migrate integration", () => {
  it("regenerated NEW md is byte-identical to the hand-written expected", async () => {
    // generateDoc resolves output paths relative to process.cwd(); use a
    // project-relative temp path so the write lands where we read it back.
    const rel = path.relative(
      process.cwd(),
      path.join(here, `fixtures/integration/.tmp-${Date.now()}.md`),
    );
    const prev = process.env.POLITTY_DOCS_UPDATE;
    process.env.POLITTY_DOCS_UPDATE = "true";
    try {
      await generateDoc({
        command: initCommand,
        files: { [rel]: [""] },
      });
    } finally {
      if (prev === undefined) delete process.env.POLITTY_DOCS_UPDATE;
      else process.env.POLITTY_DOCS_UPDATE = prev;
    }
    const generated = fs.readFileSync(rel, "utf-8");
    fs.rmSync(rel, { force: true });

    // The committed expected fixture is the canonical NEW-format golden.
    expect(generated).toBe(read("fixtures/integration/README.expected.md"));
  });

  it("OLD md transforms to the NEW md with marker-only differences", () => {
    const oldMd = read("fixtures/integration/README.old.md");
    const newMd = read("fixtures/integration/README.expected.md");
    expect(verifyMigration(oldMd, newMd).ok).toBe(true);
  });

  it("custom-render: inter-section prose survives the marker-only transform", () => {
    // The hand-written NEW golden wraps the build command in a single marker
    // pair and keeps the `> Note:` line between usage and options.
    const oldMd = read("fixtures/custom-render/README.old.md");
    const newMd = read("fixtures/custom-render/README.expected.md");
    const result = verifyMigration(oldMd, newMd);
    expect(result.ok).toBe(true);
    expect(newMd).toContain("builds are incremental by default");
  });

  it("custom-render: migrate() drops removed FileConfig keys and threads the Note", () => {
    // Recreate the fixture's relative layout inside a temp project so the
    // config's doc paths resolve against the temp cwd.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "politty-mig-"));
    const fixtureRel = "tests/migrate/fixtures/custom-render";
    fs.mkdirSync(path.join(tmp, fixtureRel), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, fixtureRel, "config.old.ts"),
      read("fixtures/custom-render/config.old.ts"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, fixtureRel, "README.old.md"),
      read("fixtures/custom-render/README.old.md"),
      "utf-8",
    );

    const report = migrate({ cwd: tmp, dryRun: false });
    expect(report.files.some((f) => f.changed)).toBe(true);

    const rewritten = fs.readFileSync(path.join(tmp, fixtureRel, "config.old.ts"), "utf-8");
    // Illegal NEW-API keys must be gone.
    expect(rewritten).not.toContain("render: customRenderer");
    expect(rewritten).not.toContain('title: "Build Docs"');
    expect(rewritten).not.toContain('description: "How to build."');
    // A per-command override threading the Note must be emitted.
    expect(rewritten).toContain("(md) =>");
    expect(rewritten).toContain("${md.usage}");
    expect(rewritten).toContain("builds are incremental by default");
    expect(rewritten).toContain('"build":');

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("rootdoc-globalopts: migrate() generates a rootDoc.layout with md.globalOptions/md.index", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "politty-mig-"));
    const fixtureRel = "tests/migrate/fixtures/rootdoc-globalopts";
    fs.mkdirSync(path.join(tmp, fixtureRel), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, fixtureRel, "config.old.ts"),
      read("fixtures/rootdoc-globalopts/config.old.ts"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmp, fixtureRel, "REFERENCE.old.md"),
      read("fixtures/rootdoc-globalopts/REFERENCE.old.md"),
      "utf-8",
    );

    const report = migrate({ cwd: tmp, dryRun: false });
    expect(report.files.some((f) => f.changed)).toBe(true);

    const rewritten = fs.readFileSync(path.join(tmp, fixtureRel, "config.old.ts"), "utf-8");
    expect(rewritten).toContain("layout:");
    expect(rewritten).toContain("${md.globalOptions}");
    expect(rewritten).toContain("${md.index}");
    // The header prose must be preserved in the layout.
    expect(rewritten).toContain("# project-cli");
    expect(rewritten).toContain("## Global Options");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("migrate() rewrites a copied project and writes the playbook (no dry-run)", () => {
    // Copy the spread-base fixture into a temp project and run migrate.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "politty-mig-"));
    const configPath = path.join(tmp, "config.ts");
    fs.writeFileSync(configPath, read("fixtures/spread-base/config.old.ts"), "utf-8");

    const report = migrate({ cwd: tmp, dryRun: false });
    expect(report.files).toHaveLength(1);
    expect(report.files[0]!.todos.some((t) => t.category === "spread-config")).toBe(true);

    const playbook = fs.readFileSync(report.playbookPath, "utf-8");
    expect(playbook).toContain("New doc-template API (summary)");
    expect(playbook).toContain("spread-config");
    expect(fs.readFileSync(configPath, "utf-8")).toContain(
      "// TODO(politty-migrate: spread-config)",
    );

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("files-var-ref: migrate() resolves `const files` and leaves NO silent miss", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "politty-mig-"));
    const configPath = path.join(tmp, "docs.test.ts");
    fs.writeFileSync(configPath, read("fixtures/files-var-ref/config.old.ts"), "utf-8");

    const report = migrate({ cwd: tmp, dryRun: false });
    const fileReport = report.files[0]!;
    // The defining invariant for the bug this work fixes.
    expect(fileReport.silentMisses).toEqual([]);

    const rewritten = fs.readFileSync(configPath, "utf-8");
    expect(rewritten).not.toMatch(/^\s*title\s*:/m);
    expect(rewritten).not.toMatch(/^\s*description\s*:/m);
    expect(rewritten).not.toMatch(/^\s*render\s*:/m);
    expect(rewritten).toContain("layout: (md) =>");
    expect(rewritten).toContain("${md.commands()}");
    // Default-equivalent renders dropped silently; the custom one is flagged.
    expect(report.todos.filter((t) => t.category === "layout-review")).toHaveLength(1);

    // The playbook documents the FileConfig conversion.
    const playbook = fs.readFileSync(report.playbookPath, "utf-8");
    expect(playbook).toContain("`title`/`description`/`render` -> `layout`");
    expect(playbook).toContain("Variable-referenced `files`");

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("NO-SILENT-MISS invariant holds across every config fixture", () => {
    const fixturesDir = path.join(here, "fixtures");
    const dirs = fs
      .readdirSync(fixturesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    for (const dir of dirs) {
      const cfg = path.join(fixturesDir, dir, "config.old.ts");
      if (!fs.existsSync(cfg)) continue;
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "politty-mig-scan-"));
      // Recreate the fixture's relative layout so doc paths can resolve.
      const rel = `tests/migrate/fixtures/${dir}`;
      fs.mkdirSync(path.join(tmp, rel), { recursive: true });
      for (const f of fs.readdirSync(path.join(fixturesDir, dir))) {
        fs.copyFileSync(path.join(fixturesDir, dir, f), path.join(tmp, rel, f));
      }
      // Also place a copy at the root so a fixture with root-relative paths is
      // still picked up by the scanner.
      fs.copyFileSync(cfg, path.join(tmp, "config.old.ts"));
      const report = migrate({ cwd: tmp, dryRun: false });
      for (const fr of report.files) {
        expect(
          fr.silentMisses,
          `silent miss in fixture ${dir}: ${JSON.stringify(fr.silentMisses)}`,
        ).toEqual([]);
      }
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("migrate() with dry-run does not modify files", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "politty-mig-"));
    const configPath = path.join(tmp, "config.ts");
    const before = read("fixtures/spread-base/config.old.ts");
    fs.writeFileSync(configPath, before, "utf-8");

    const report = migrate({ cwd: tmp, dryRun: true });
    expect(report.dryRun).toBe(true);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(before);
    expect(fs.existsSync(report.playbookPath)).toBe(false);

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
