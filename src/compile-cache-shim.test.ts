import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatShimPath, generateCompileCacheShim } from "./compile-cache-shim.js";

describe("generateCompileCacheShim", () => {
  let cwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "politty-shim-"));
  });

  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  const writePkg = (pkg: Record<string, unknown>) => {
    writeFileSync(join(cwd, "package.json"), JSON.stringify(pkg));
  };

  it("generates an executable ESM shim with program and entry baked in", () => {
    writePkg({ name: "my-cli", type: "module" });
    const result = generateCompileCacheShim({ entry: "./cli.js", out: "dist/bin.js", cwd });

    expect(result.outputPath).toBe(join(cwd, "dist", "bin.js"));
    expect(result.program).toBe("my-cli");
    const content = readFileSync(result.outputPath, "utf8");
    expect(content.startsWith("#!/usr/bin/env node\n")).toBe(true);
    expect(content).toContain('import { enableCompileCache } from "politty/compile-cache";');
    expect(content).toContain('enableCompileCache("my-cli");');
    expect(content).toContain('await import("./cli.js");');
    if (process.platform !== "win32") {
      expect(statSync(result.outputPath).mode & 0o111).not.toBe(0);
    }
  });

  it("defaults the program name to the first bin entry", () => {
    writePkg({ name: "@scope/pkg-name", type: "module", bin: { "my-tool": "./dist/bin.js" } });
    const result = generateCompileCacheShim({ entry: "./cli.js", out: "dist/bin.js", cwd });
    expect(result.program).toBe("my-tool");
  });

  it("falls back to the package name without its scope", () => {
    writePkg({ name: "@scope/pkg-name", type: "module" });
    const result = generateCompileCacheShim({ entry: "./cli.js", out: "dist/bin.js", cwd });
    expect(result.program).toBe("pkg-name");
  });

  it("prefers an explicit program name", () => {
    writePkg({ name: "my-cli", type: "module" });
    const result = generateCompileCacheShim({
      entry: "./cli.js",
      out: "dist/bin.js",
      program: "custom",
      cwd,
    });
    expect(result.program).toBe("custom");
    expect(readFileSync(result.outputPath, "utf8")).toContain('enableCompileCache("custom");');
  });

  it("throws when no program name can be derived", () => {
    expect(() => generateCompileCacheShim({ entry: "./cli.js", out: "dist/bin.mjs", cwd })).toThrow(
      /program name/,
    );
  });

  it("rejects a .js output in a package without type module", () => {
    writePkg({ name: "my-cli" });
    expect(() => generateCompileCacheShim({ entry: "./cli.js", out: "dist/bin.js", cwd })).toThrow(
      /\.mjs/,
    );
  });

  it("allows a .mjs output in a package without type module", () => {
    writePkg({ name: "my-cli" });
    const result = generateCompileCacheShim({ entry: "./cli.js", out: "dist/bin.mjs", cwd });
    expect(readFileSync(result.outputPath, "utf8")).toContain('await import("./cli.js");');
  });

  it("rejects a .cjs output", () => {
    writePkg({ name: "my-cli", type: "module" });
    expect(() => generateCompileCacheShim({ entry: "./cli.js", out: "dist/bin.cjs", cwd })).toThrow(
      /ES module/,
    );
  });
});

describe("formatShimPath", () => {
  it("returns a relative path for outputs inside cwd", () => {
    expect(formatShimPath("/proj/dist/bin.js", "/proj")).toBe(join("dist", "bin.js"));
  });

  it("returns the absolute path for outputs outside cwd", () => {
    expect(formatShimPath("/elsewhere/bin.js", "/proj")).toBe("/elsewhere/bin.js");
  });
});
