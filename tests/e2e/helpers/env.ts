// Paramètres partagés entre playwright.config.ts (serveur) et les tests (lecture de l'outbox, base).
import { join } from "node:path";

export const E2E_PORT = 3100;
export const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;
export const E2E_OUTBOX_DIR = join(process.cwd(), "test-results", "outbox");
export const E2E_PASSWORD = "correct-horse-battery-staple";
