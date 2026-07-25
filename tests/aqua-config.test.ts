import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface AquaPackage {
  name: string;
}

interface AquaConfig {
  checksum: { enabled: boolean };
  registries: { type: string; ref: string }[];
  packages: AquaPackage[];
}

interface ChecksumEntry {
  id: string;
  checksum: string;
  algorithm: string;
}

interface ChecksumsFile {
  checksums: ChecksumEntry[];
}

const aquaConfig = parseYaml(readFileSync(resolve(rootDir, "aqua.yaml"), "utf8")) as AquaConfig;

const checksumsFile = JSON.parse(
  readFileSync(resolve(rootDir, "aqua-checksums.json"), "utf8"),
) as ChecksumsFile;

describe("aqua.yaml", () => {
  it("enables checksum verification", () => {
    expect(aquaConfig.checksum.enabled).toBe(true);
  });

  it("declares the new jqlang/jq@jq-1.8.2 package", () => {
    const names = aquaConfig.packages.map((pkg) => pkg.name);
    expect(names).toContain("jqlang/jq@jq-1.8.2");
  });

  it("keeps the previously declared packages alongside the new one", () => {
    const names = aquaConfig.packages.map((pkg) => pkg.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "suzuki-shunsuke/ghalint@v1.5.6",
        "suzuki-shunsuke/pinact@v4.1.0",
        "jqlang/jq@jq-1.8.2",
      ]),
    );
  });

  it("has no duplicate package names", () => {
    const names = aquaConfig.packages.map((pkg) => pkg.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("declares every package as '<owner>/<repo>@<version>'", () => {
    for (const pkg of aquaConfig.packages) {
      expect(pkg.name).toMatch(/^[\w.-]+\/[\w.-]+@[\w.-]+$/);
    }
  });
});

describe("aqua-checksums.json", () => {
  it("is a non-empty checksums array", () => {
    expect(Array.isArray(checksumsFile.checksums)).toBe(true);
    expect(checksumsFile.checksums.length).toBeGreaterThan(0);
  });

  it("has no duplicate ids", () => {
    const ids = checksumsFile.checksums.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("only records sha256 digests as 64 uppercase hex characters", () => {
    for (const entry of checksumsFile.checksums) {
      expect(entry.algorithm).toBe("sha256");
      expect(entry.checksum).toMatch(/^[0-9A-F]{64}$/);
    }
  });

  const expectedJqChecksums: [string, string][] = [
    [
      "github_release/github.com/jqlang/jq/jq-1.8.2/jq-linux-amd64",
      "B1C22172DD303F3BE49E935AA56AA48A8B7A46E0BC838B4997D3BB451495870F",
    ],
    [
      "github_release/github.com/jqlang/jq/jq-1.8.2/jq-linux-arm64",
      "8B85C817833814DDCA00A144C33705546355AFCCF0CF39B188F3CDB48B852309",
    ],
    [
      "github_release/github.com/jqlang/jq/jq-1.8.2/jq-macos-amd64",
      "E94B266E3C26690550006ABE63152B782280F4E14374ACCDF04CBDE844F00BC0",
    ],
    [
      "github_release/github.com/jqlang/jq/jq-1.8.2/jq-macos-arm64",
      "2D75340BA57A4B4B4C8708A21C2DC8E958A48AAA8BBA13B27F77F6E4C0ECA07E",
    ],
    [
      "github_release/github.com/jqlang/jq/jq-1.8.2/jq-windows-amd64.exe",
      "A6FC67FEDAF9128A3309A1E2EBB8B986AECCF70122EE46D2CB4849E423F0C627",
    ],
  ];

  it.each(expectedJqChecksums)("records the exact sha256 checksum for %s", (id, checksum) => {
    const entry = checksumsFile.checksums.find((c) => c.id === id);
    expect(entry).toBeDefined();
    expect(entry?.checksum).toBe(checksum);
    expect(entry?.algorithm).toBe("sha256");
  });

  it("covers exactly the five jq-1.8.2 release platform binaries", () => {
    const jqIds = checksumsFile.checksums
      .map((entry) => entry.id)
      .filter((id) => id.includes("jqlang/jq/jq-1.8.2/"));
    expect(jqIds.sort()).toEqual(expectedJqChecksums.map(([id]) => id).sort());
  });

  it("updates the aqua-registry checksum entry to v4.539.0", () => {
    const registryEntry = checksumsFile.checksums.find((entry) =>
      entry.id.startsWith("registries/github_content/github.com/aquaproj/aqua-registry/"),
    );
    expect(registryEntry?.id).toBe(
      "registries/github_content/github.com/aquaproj/aqua-registry/v4.539.0/registry.yaml",
    );
    expect(registryEntry?.checksum).toBe(
      "E022DF660F01744ABFE3E93FABC7FE17E36885549E447BB2667208D2E5804F4D",
    );
  });

  it("removes the stale v4.533.0 aqua-registry checksum entry", () => {
    const staleEntry = checksumsFile.checksums.find((entry) =>
      entry.id.includes("aqua-registry/v4.533.0"),
    );
    expect(staleEntry).toBeUndefined();
  });
});

describe("aqua.yaml <-> aqua-checksums.json consistency", () => {
  const ids = checksumsFile.checksums.map((entry) => entry.id);

  it.each(aquaConfig.packages.map((pkg) => pkg.name))(
    "has at least one checksum recorded for package %s",
    (name) => {
      const atIndex = name.lastIndexOf("@");
      const repo = name.slice(0, atIndex);
      const version = name.slice(atIndex + 1);
      const hasMatch = ids.some((id) => id.includes(`github.com/${repo}/`) && id.includes(version));
      expect(hasMatch).toBe(true);
    },
  );
});