import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";

const require = createRequire(import.meta.url);
const organizerRequire = createRequire(require.resolve("organize-imports-cli/package.json"));
const editorconfig = organizerRequire("editorconfig") as {
  parseSync: (file: string) => Record<string, unknown>;
};

it("selects EditorConfig sections through the overridden minimatch dependency", () => {
  const dir = mkdtempSync(join(tmpdir(), "politty-editorconfig-"));
  try {
    writeFileSync(
      join(dir, ".editorconfig"),
      "root = true\n\n[*]\nindent_size = 2\n\n[*.{ts,tsx}]\nindent_size = 4\n\n[src/**/file[0-9].ts]\nend_of_line = lf\n",
    );
    for (const file of ["index.ts", "component.tsx"]) {
      expect(editorconfig.parseSync(join(dir, file)).indent_size).toBe(4);
    }
    expect(editorconfig.parseSync(join(dir, "notes.txt")).indent_size).toBe(2);
    expect(editorconfig.parseSync(join(dir, "src/nested/file3.ts")).end_of_line).toBe("lf");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

it("organizes imports using the selected EditorConfig line endings", () => {
  const dir = mkdtempSync(join(tmpdir(), "politty-imports-"));
  try {
    writeFileSync(join(dir, ".editorconfig"), "root = true\n\n[*.{ts,tsx}]\nend_of_line = crlf\n");
    const file = join(dir, "index.ts");
    writeFileSync(
      file,
      'import { join } from "node:path";\nimport { basename } from "node:path";\nconsole.log(join("a", basename("b")));\n',
    );
    execFileSync(process.execPath, [organizerRequire.resolve("./cli.js"), file]);
    const output = readFileSync(file, "utf8");
    expect(output).toContain('import { basename, join } from "node:path";\r\n');
    expect(output).not.toMatch(/(?<!\r)\n/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
