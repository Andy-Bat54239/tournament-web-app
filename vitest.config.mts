import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": here("./src"),
      // `server-only` throws outside a Next.js server bundle; tests run in plain Node.
      "server-only": here("./src/test/server-only-stub.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    // Starting a PGlite database takes a moment, and several test files start one at the same time.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
