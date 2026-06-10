import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pin `root` to this package's directory so includes resolve to its `tests/`
// even when invoked from the repo root (e.g. `pnpm --filter politty-migrate test`).
export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
