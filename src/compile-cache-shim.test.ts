import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
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

  it("finds the nearest package.json by walking up from a nested cwd", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/bin.js" } });
    const nested = join(cwd, "packages", "deep");
    mkdirSync(nested, { recursive: true });
    const result = generateCompileCacheShim({ entry: "./cli.js", out: "bin.js", cwd: nested });
    expect(result.program).toBe("my-tool");
    expect(result.outputPath).toBe(join(nested, "bin.js"));
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

  it("defaults the output path to the first bin path in package.json", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/bin.js" } });
    const result = generateCompileCacheShim({ entry: "./cli.js", cwd });
    expect(result.outputPath).toBe(join(cwd, "dist", "bin.js"));
  });

  it("supports the string form of bin for the default output path", () => {
    writePkg({ name: "my-cli", type: "module", bin: "./dist/bin.js" });
    const result = generateCompileCacheShim({ entry: "./cli.js", cwd });
    expect(result.outputPath).toBe(join(cwd, "dist", "bin.js"));
    expect(result.program).toBe("my-cli");
  });

  it("resolves the default output path against the package.json directory", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/bin.js" } });
    const nested = join(cwd, "scripts");
    mkdirSync(nested, { recursive: true });
    const result = generateCompileCacheShim({ entry: "./cli.js", cwd: nested });
    expect(result.outputPath).toBe(join(cwd, "dist", "bin.js"));
  });

  it("throws when out is omitted and package.json has no bin", () => {
    writePkg({ name: "my-cli", type: "module" });
    expect(() => generateCompileCacheShim({ entry: "./cli.js", cwd })).toThrow(/--out/);
  });

  it("defaults the entry to a conventional built module next to the shim", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/bin.js" } });
    mkdirSync(join(cwd, "dist"), { recursive: true });
    writeFileSync(join(cwd, "dist", "cli.js"), "console.log('cli');\n");
    const result = generateCompileCacheShim({ cwd });
    expect(result.entry).toBe("./cli.js");
    expect(readFileSync(result.outputPath, "utf8")).toContain('await import("./cli.js");');
  });

  it("falls back through the entry candidates and skips the shim itself", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/cli.js" } });
    mkdirSync(join(cwd, "dist"), { recursive: true });
    writeFileSync(join(cwd, "dist", "index.js"), "console.log('index');\n");
    const result = generateCompileCacheShim({ cwd });
    expect(result.entry).toBe("./index.js");
    expect(result.outputPath).toBe(join(cwd, "dist", "cli.js"));
  });

  it("throws when the entry cannot be derived", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/bin.js" } });
    expect(() => generateCompileCacheShim({ cwd })).toThrow(/--entry/);
  });

  it("rejects a shim that would import itself", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/cli.js" } });
    expect(() => generateCompileCacheShim({ entry: "./cli.js", cwd })).toThrow(/import itself/);
  });

  it("refuses to overwrite an existing file it did not generate", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/cli.js" } });
    mkdirSync(join(cwd, "dist"), { recursive: true });
    writeFileSync(join(cwd, "dist", "cli.js"), "console.log('real cli');\n");
    expect(() => generateCompileCacheShim({ entry: "./main.js", cwd })).toThrow(
      /Refusing to overwrite/,
    );
  });

  it("regenerates over a previously generated shim", () => {
    writePkg({ name: "my-cli", type: "module", bin: { "my-tool": "./dist/bin.js" } });
    const first = generateCompileCacheShim({ entry: "./cli.js", cwd });
    const second = generateCompileCacheShim({ entry: "./other.js", cwd });
    expect(second.outputPath).toBe(first.outputPath);
    expect(readFileSync(second.outputPath, "utf8")).toContain('await import("./other.js");');
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
