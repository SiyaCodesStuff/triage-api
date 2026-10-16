import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/tests/api.test.ts",
      "src/tests/seed.test.ts",
      "src/tests/security.test.ts",
      "src/tests/openapi.test.ts",
    ],
    setupFiles: ["./src/tests/setup.ts"],
    clearMocks: true,
  },
});
