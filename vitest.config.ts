import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // `runMain` enables the Node compile cache keyed by command name under
    // `${XDG_CACHE_HOME:-$HOME/.cache}`. Point XDG at the OS tmpdir so test
    // runs never litter the real user cache with fixture command names. The
    // pid suffix isolates concurrent vitest processes (watch mode + CI etc.)
    // from each other.
    env: {
      XDG_CACHE_HOME: join(tmpdir(), `politty-vitest-xdg-cache-${process.pid}`),
    },
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "packages/*/src/**/*.test.ts",
            "tests/**/*.test.ts",
            "playground/**/*.test.ts",
            "playground/**/index.test.ts",
          ],
          exclude: ["tests/shell-completion/**", "tests/dist-compat/**"],
          // Core tests exercise zod fixture schemas without importing an
          // `@politty/zod` entry, so the adapter registration that entry
          // modules perform for real users happens in this setup file.
          setupFiles: ["./tests/utils/register-zod-adapter.ts"],
        },
      },
      // Compatibility checks against BUILT output (politty alias dist);
      // builds the workspace in beforeAll, hence the generous hook budget.
      {
        test: {
          name: "dist-compat",
          include: ["tests/dist-compat/**/*.test.ts"],
          testTimeout: 30000,
          // The workspace is built once in globalSetup rather than per file:
          // these files run in parallel and tsdown builds with `clean: true`,
          // so concurrent rebuilds would delete output a sibling file is
          // importing.
          globalSetup: ["./tests/dist-compat/global-setup.ts"],
        },
      },
      // The shell-* projects need no adapter setup: they drive completion
      // through `tsx` subprocesses, which import the `@politty/zod` entry
      // and register the adapter themselves.
      {
        test: {
          name: "shell-bash",
          include: ["tests/shell-completion/bash.test.ts"],
          testTimeout: 10000,
          // beforeAll generates three full completion script sets via
          // `tsx`/Node startup; the default 10s hook budget is too tight.
          hookTimeout: 60000,
        },
      },
      {
        test: {
          name: "shell-zsh",
          include: ["tests/shell-completion/zsh.test.ts"],
          testTimeout: 10000,
          hookTimeout: 60000,
        },
      },
      {
        test: {
          name: "shell-fish",
          include: ["tests/shell-completion/fish.test.ts"],
          testTimeout: 10000,
          hookTimeout: 60000,
        },
      },
    ],
    environment: "node",
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
      include: [
        "packages/*/src/**/*.test.ts",
        "tests/**/*.test.ts",
        "playground/**/*.test.ts",
        "playground/**/index.test.ts",
      ],
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["packages/*/src/**/*.test.ts", "packages/*/src/**/*.d.ts"],
    },
  },
});
