import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Pin `root` to this config's directory so includes resolve to migrate/tests
// even when invoked from the repo root (`vitest run --config migrate/vitest.config.ts`).
export default defineConfig({
  test: {
    root: fileURLToPath(new URL(".", import.meta.url)),
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
