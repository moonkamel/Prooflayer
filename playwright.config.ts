import { rmSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import { E2E_BASE_URL, E2E_OUTBOX_DIR, E2E_PORT } from "./tests/e2e/helpers/env";

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

// Boîte d'envoi vidée à chaque exécution : un test ne lit jamais l'email d'une exécution précédente.
rmSync(E2E_OUTBOX_DIR, { recursive: true, force: true });

export default defineConfig({
  testDir: "tests/e2e",
  // Les parcours d'authentification partagent la limite de débit par IP de Better Auth : un seul worker.
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: E2E_BASE_URL,
    trace: "off",
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        locale: "fr-FR",
        ...(executablePath ? { launchOptions: { executablePath } } : {}),
      },
    },
  ],
  webServer: {
    command: `pnpm start --port ${E2E_PORT}`,
    url: E2E_BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Base : fournie par l'environnement (CI ou poste local), sous le rôle applicatif.
      DATABASE_URL: process.env.DATABASE_URL ?? "",
      BETTER_AUTH_URL: E2E_BASE_URL,
      // Secret de test uniquement, sans valeur hors de ce serveur éphémère.
      BETTER_AUTH_SECRET:
        process.env.BETTER_AUTH_SECRET ?? "e2e-only-secret-not-used-anywhere-else-0123456789",
      EMAIL_TRANSPORT: "outbox",
      EMAIL_OUTBOX_DIR: E2E_OUTBOX_DIR,
    },
  },
});
