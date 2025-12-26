import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts", "playground/**/*.test.ts"],
    environment: "node",
    typecheck: {
      enabled: true,
      tsconfig: "./tsconfig.json",
      include: ["src/**/*.test.ts", "tests/**/*.test.ts", "playground/**/*.test.ts"],
    },
  },
});
