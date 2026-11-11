import { randomInt, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./env";
import { waitForEmailLink } from "./outbox";

export const uniqueEmail = (label: string) =>
  `${label}-${randomUUID().slice(0, 8)}@e2e.prooflayer.test`;

/**
 * Better Auth limite /sign-in et /sign-up à 3 tentatives par 10 s et par IP (en production, donc sous `next start`).
 * Chaque parcours simule un client distinct en présentant une IP de la plage de test 198.18.0.0/15 (RFC 2544).
 * La limite reste active : tests/e2e/auth.spec.ts vérifie qu'elle bloque la 4e tentative d'une même IP.
 */
export async function withFreshClientIp(page: Page): Promise<string> {
  const ip = `198.18.${randomInt(0, 256)}.${randomInt(1, 255)}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

/** Messages de l'application, hors annonceur de navigation de Next.js (qui porte aussi role="alert"). */
export const appAlert = (page: Page) => page.getByRole("main").getByRole("alert");
export const appStatus = (page: Page) => page.getByRole("main").getByRole("status");

/** Inscription par email et mot de passe, puis ouverture du lien de vérification (connexion automatique). */
export async function signUpAndVerify(
  page: Page,
  email: string,
  name = "Clara Martin",
): Promise<void> {
  const since = new Date();
  await withFreshClientIp(page);
  await page.goto("/sign-up");
  await page.getByLabel("Nom complet").fill(name);
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(appStatus(page)).toContainText(email);

  const link = await waitForEmailLink(email, "Vérifiez votre adresse email", since);
  await page.goto(link);
  await expect(page).toHaveURL(/\/verify-email/u);
  await expect(appStatus(page)).toHaveText(
    "Votre adresse email est vérifiée. Vous pouvez continuer.",
  );
}

export async function signIn(page: Page, email: string, password = E2E_PASSWORD): Promise<void> {
  await withFreshClientIp(page);
  await page.goto("/sign-in");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
}
