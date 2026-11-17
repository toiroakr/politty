#!/usr/bin/env node
// Forces a single dependency to an exact version across the whole pnpm
// workspace via `pnpm-workspace.yaml`'s `overrides`, so the peer-floor CI
// job actually exercises the version declared as a package's
// `peerDependencies` lower bound instead of whatever `^range` resolution
// happens to pick (which is always the newest satisfying version, never the
// floor). `pnpm install` after this pin re-resolves the lockfile onto the
// override, including transitive occurrences (e.g. via `knip`).

import { execFileSync } from "node:child_process";

const [dep, version] = process.argv.slice(2);
if (!dep || !version) {
  console.error("usage: pin-peer-floor.mjs <dep> <version>");
  process.exit(1);
}

const overrides =
  JSON.parse(
    execFileSync("pnpm", ["config", "get", "overrides", "--json", "--location", "project"], {
      encoding: "utf8",
    }),
  ) ?? {};
overrides[dep] = version;
execFileSync("pnpm", [
  "config",
  "set",
  "--location",
  "project",
  "--json",
  "overrides",
  JSON.stringify(overrides),
]);
console.log(`pinned ${dep}@${version} via pnpm-workspace.yaml overrides`);
