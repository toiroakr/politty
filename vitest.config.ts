import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          include: [
            "src/**/*.test.ts",
            "tests/**/*.test.ts",
            "playground/**/*.test.ts",
            "playground/**/index.test.ts",
          ],
          exclude: ["tests/shell-completion/**"],
        },
      },
      {
        test: {
          name: "shell-bash",
          include: ["tests/shell-completion/bash.test.ts"],
        },
      },
      {
        test: {
          name: "shell-zsh",
          include: ["tests/shell-completion/zsh.test.ts"],
        },
      },
      {
        test: {
          name: "shell-fish",
          include: ["tests/shell-completion/fish.test.ts"],
        },
      },
    ],
    environment: "node",
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
      include: [
        "src/**/*.test.ts",
        "tests/**/*.test.ts",
        "playground/**/*.test.ts",
        "playground/**/index.test.ts",
      ],
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      reportsDirectory: "./coverage",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.d.ts"],
    },
  },
});
