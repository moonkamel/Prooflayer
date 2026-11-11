import { randomInt, randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { E2E_PASSWORD } from "./env";
import { waitForEmailLink } from "./outbox";
import { totp } from "./totp";

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

/** Dernier code TOTP accepté par secret : un code n'est jamais rejoué dans sa fenêtre de 30 s. */
const lastTotp = new Map<string, string>();

export async function nextTotp(secret: string): Promise<string> {
  let code = totp(secret);
  while (code === lastTotp.get(secret)) {
    await new Promise((r) => setTimeout(r, 1_000));
    code = totp(secret);
  }
  lastTotp.set(secret, code);
  return code;
}

interface SignUpOptions {
  name?: string;
  /** Nom de l'entreprise (inscription sans invitation). */
  company?: string;
  /** Chemin de retour (lien d'invitation) : aucune organisation n'est créée. */
  next?: string;
}

/** Inscription par email et mot de passe, puis ouverture du lien de vérification (connexion automatique). */
export async function signUpAndVerify(page: Page, email: string, options: SignUpOptions = {}) {
  const since = new Date();
  await withFreshClientIp(page);
  await page.goto(options.next ? `/sign-up?next=${encodeURIComponent(options.next)}` : "/sign-up");
  await page.getByLabel("Nom complet").fill(options.name ?? "Clara Martin");
  if (!options.next) await page.getByLabel("Nom de l'entreprise").fill(options.company ?? "Talvio");
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

export async function enableTwoFactor(
  page: Page,
): Promise<{ secret: string; backupCodes: string[] }> {
  if (!/\/setup-two-factor/u.test(page.url())) await page.goto("/setup-two-factor");
  await page.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Commencer" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/u);
  await page
    .getByLabel("Saisissez le code à 6 chiffres affiché par l'application.")
    .fill(await nextTotp(secret));
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(appStatus(page)).toHaveText("La double authentification est active.");
  const backupCodes = (
    await page.getByTestId("backup-codes").locator("code").allTextContents()
  ).map((c) => c.trim());
  await page.getByRole("button", { name: "J'ai conservé mes codes" }).click();
  await expect(page).toHaveURL(/\/account/u);
  return { secret, backupCodes };
}

/**
 * Parcours complet d'une nouvelle entreprise (§5.1) : inscription, vérification, création de l'organisation
 * (l'utilisateur en devient owner), puis activation imposée de la 2FA.
 */
export async function createWorkspace(page: Page, email: string, company = "Talvio") {
  await signUpAndVerify(page, email, { company });
  await page.getByRole("link", { name: "Continuer" }).click();
  await expect(page).toHaveURL(/\/onboarding/u);
  await expect(page.getByLabel("Nom de l'entreprise")).toHaveValue(company);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/setup-two-factor/u);
  return enableTwoFactor(page);
}

/** Connexion ; avec `secret`, saisit aussi le code TOTP. */
export async function signIn(
  page: Page,
  email: string,
  password = E2E_PASSWORD,
  secret?: string,
): Promise<void> {
  await withFreshClientIp(page);
  await page.goto("/sign-in");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill(password);
  await page.getByRole("button", { name: "Se connecter" }).click();
  if (secret) {
    await expect(page).toHaveURL(/\/two-factor/u);
    await page.getByLabel("Code").fill(await nextTotp(secret));
    await page.getByRole("button", { name: "Vérifier" }).click();
  }
}

export async function signOut(page: Page): Promise<void> {
  await page.goto("/account");
  await page.getByRole("button", { name: "Se déconnecter" }).click();
  await expect(page).toHaveURL(/\/sign-in/u);
}
