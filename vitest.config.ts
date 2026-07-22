import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Vite doesn't apply the @anthropic-ai/sdk `./helpers/*` bare-wildcard export map,
// so point the one deep helper we import at its concrete .mjs. Node's resolver
// handles the bare path natively, so production (tsx/tsc) is unaffected.
const sdkJsonSchemaHelper = fileURLToPath(
  new URL("./node_modules/@anthropic-ai/sdk/helpers/beta/json-schema.mjs", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: {
      "@anthropic-ai/sdk/helpers/beta/json-schema": sdkJsonSchemaHelper,
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // git-subprocess + init tests are legitimately slow under parallel load
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
