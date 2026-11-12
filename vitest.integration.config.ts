// Tests d'intégration : base Postgres réelle, migrations appliquées. DATABASE_URL vise le rôle applicatif.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // Une seule base partagée : fichiers exécutés l'un après l'autre.
    fileParallelism: false,
    globalSetup: ["tests/publish-control-library.ts"],
  },
});
