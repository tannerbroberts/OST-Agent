import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // git-subprocess + init tests are legitimately slow under parallel load
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
