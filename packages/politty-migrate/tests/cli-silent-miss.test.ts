import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";

/**
 * The CLI must SURFACE and FAIL on genuine silentMisses, but must NOT
 * false-positive on `title`/`description`/`render` keys in unrelated objects
 * (scanSilentMisses scopes those FileConfig keys to objects that also have a
 * `commands` sibling).
 */
describe("CLI no-silent-miss guard", () => {
  const dirs: string[] = [];
  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = 0;
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  function tmpProject(): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "politty-migrate-cli-"));
    dirs.push(d);
    return d;
  }

  function run(config: string, extraArgs: string[] = []): string {
    const dir = tmpProject();
    const file = path.join(dir, "docs.test.ts");
    fs.writeFileSync(file, config, "utf-8");
    const errSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    vi.spyOn(console, "log").mockImplementation(() => {});
    main([...extraArgs, "--file", file, dir]);
    return errSpy.mock.calls.map((c) => String(c[0])).join("");
  }

  it("fails (exit non-zero) and reports a genuine silent miss left behind", () => {
    // A FileConfig-shaped object (`commands` + removed `title`) that the rewriter
    // never migrates because `files` itself is an unresolvable external import.
    // scanSilentMisses flags the leftover removed key with no nearby TODO.
    const errOutput = run(`import { assertDocMatch } from "politty/docs";
import { command } from "./command.js";
import { externalFiles } from "./files.js";

const leftover = { commands: ["x"], title: "Leftover FileConfig title" };

await assertDocMatch({ command, files: externalFiles });
`);
    expect(errOutput).toMatch(/silent miss/i);
    expect(errOutput).toMatch(/title/);
    expect(process.exitCode).toBe(1);
  });

  it("does NOT false-positive on title/description in unrelated objects", () => {
    // `title`/`description` here belong to an object with no `commands` sibling,
    // so they are not FileConfig keys and must not be flagged as a silent miss.
    // Also exercises the explicit migration-name positional form.
    const errOutput = run(
      `import { assertDocMatch } from "politty/docs";
import { command } from "./command.js";

const unrelated = {
  title: "just a title",
  description: "just a description",
};

await assertDocMatch({
  command,
  files: { "docs/a.md": [""] },
});
`,
      ["doc-markers"],
    );
    expect(errOutput).not.toMatch(/silent miss/i);
    expect(process.exitCode).toBe(0);
  });
});
