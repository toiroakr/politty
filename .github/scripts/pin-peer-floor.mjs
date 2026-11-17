#!/usr/bin/env node
// Forces a single dependency to an exact version across the whole pnpm
// workspace via `pnpm-workspace.yaml`'s `overrides`, so the peer-floor CI
// job actually exercises the version declared as a package's
// `peerDependencies` lower bound instead of whatever `^range` resolution
// happens to pick (which is always the newest satisfying version, never the
// floor). `pnpm install` after this pin re-resolves the lockfile onto the
// override, including transitive occurrences (e.g. via `knip`).

import { readFileSync, writeFileSync } from "node:fs";
import { parseDocument } from "yaml";

const [dep, version] = process.argv.slice(2);
if (!dep || !version) {
  console.error("usage: pin-peer-floor.mjs <dep> <version>");
  process.exit(1);
}

const file = "pnpm-workspace.yaml";
const workspace = parseDocument(readFileSync(file, "utf8"));
workspace.setIn(["overrides", dep], version);
writeFileSync(file, String(workspace));
console.log(`pinned ${dep}@${version} via pnpm-workspace.yaml overrides`);
