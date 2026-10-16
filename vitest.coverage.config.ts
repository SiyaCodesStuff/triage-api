import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    fileParallelism: false,
    maxWorkers: 1,
    projects: [
      { extends: "./vitest.config.ts", test: { name: "unit" } },
      {
        extends: "./vitest.integration.config.ts",
        test: { name: "integration" },
      },
    ],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/tests/**", "src/**/*.d.ts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: { lines: 80 },
    },
  },
});
