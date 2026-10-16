import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/tests/database.test.ts",
      "src/tests/users.integration.test.ts",
      "src/tests/tickets.integration.test.ts",
      "src/tests/comments.integration.test.ts",
    ],
    setupFiles: ["./src/tests/integration.setup.ts"],
    clearMocks: true,
  },
});
