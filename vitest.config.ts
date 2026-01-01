import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/**/*.test.ts",
      "tests/**/*.test.ts",
      "playground/**/*.test.ts",
      "playground/**/index.test.ts",
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
