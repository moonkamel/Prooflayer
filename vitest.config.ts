import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}", "tests/**/*.test.{ts,tsx}", "packages/*/test/**/*.test.ts"],
    // Intégration (base réelle) : vitest.integration.config.ts, lancé par `pnpm test:integration`.
    exclude: ["tests/e2e/**", "tests/integration/**", "node_modules/**"],
    environment: "node",
  },
});
