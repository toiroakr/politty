#!/usr/bin/env node
// Fails loudly if `pin-peer-floor.mjs` + `pnpm install` didn't actually land
// the intended floor version everywhere in the workspace. Without this, a
// silently-ignored override (e.g. a future pnpm-workspace.yaml format
// change) would leave the peer-floor job testing whatever the latest
// resolvable version is and passing green without verifying anything.

import { execFileSync } from "node:child_process";

const [dep, version] = process.argv.slice(2);
if (!dep || !version) {
  console.error("usage: verify-peer-floor.mjs <dep> <version>");
  process.exit(1);
}

const raw = execFileSync("pnpm", ["why", dep, "--json"], { encoding: "utf8" });
const entries = JSON.parse(raw);

const versions = [...new Set(entries.map((e) => e.version))];
if (versions.length !== 1 || versions[0] !== version) {
  console.error(
    `expected ${dep}@${version} to be the only resolved version, but found: ${versions.join(", ") || "(none)"}`,
  );
  process.exit(1);
}

console.log(`confirmed ${dep}@${version} is the only version resolved in the workspace`);
