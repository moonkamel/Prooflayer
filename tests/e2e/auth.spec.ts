// PL-103 — Parcours d'authentification de bout en bout, sur une vraie base et le vrai serveur.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import {
  appAlert,
  appStatus,
  signIn,
  signOut,
  signUpAndVerify,
  uniqueEmail,
  withFreshClientIp,
} from "./helpers/auth";
import { E2E_PASSWORD } from "./helpers/env";
import { waitForEmailLink } from "./helpers/outbox";
import { totp } from "./helpers/totp";

// Parcours en série : chacun ouvre plusieurs sessions et les limites de débit de Better Auth s'appliquent par IP.
test.describe.configure({ mode: "serial" });

async function enableTwoFactor(page: Page): Promise<{ secret: string; backupCodes: string[] }> {
  await page.goto("/setup-two-factor");
  await page.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Commencer" }).click();
  const secret = (await page.getByTestId("totp-secret").textContent())?.trim() ?? "";
  expect(secret).toMatch(/^[A-Z2-7]+=*$/u);
  await page
    .getByLabel("Saisissez le code à 6 chiffres affiché par l'application.")
    .fill(totp(secret));
  await page.getByRole("button", { name: "Activer" }).click();
  await expect(appStatus(page)).toHaveText("La double authentification est active.");
  const backupCodes = (
    await page.getByTestId("backup-codes").locator("code").allTextContents()
  ).map((c) => c.trim());
  await page.getByRole("button", { name: "J'ai conservé mes codes" }).click();
  await expect(page).toHaveURL(/\/account/u);
  return { secret, backupCodes };
}

/** Code TOTP d'une fenêtre de 30 s différente de `previous`, pour ne jamais rejouer un code déjà accepté. */
async function freshTotp(secret: string, previous: string): Promise<string> {
  let code = totp(secret);
  while (code === previous) {
    await new Promise((r) => setTimeout(r, 1_000));
    code = totp(secret);
  }
  return code;
}

test("inscription, vérification de l'email, connexion et déconnexion", async ({ page }) => {
  const email = uniqueEmail("signup");
  await signUpAndVerify(page, email);

  // Connecté automatiquement après la vérification.
  await page.goto("/account");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mon profil");
  await expect(page.getByText(email)).toBeVisible();

  await signOut(page);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/u);

  await signIn(page, email);
  await expect(page).toHaveURL(/\/account/u);
});

test("connexion refusée avec un mauvais mot de passe ou un email non vérifié", async ({ page }) => {
  const email = uniqueEmail("unverified");
  await withFreshClientIp(page);
  await page.goto("/sign-up");
  await page.getByLabel("Nom complet").fill("Mehdi");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(appStatus(page)).toContainText(email);

  const since = new Date();
  await signIn(page, email);
  await expect(appAlert(page)).toContainText("n'est pas encore vérifiée");
  // Un nouveau lien est envoyé à la tentative de connexion.
  await waitForEmailLink(email, "Vérifiez votre adresse email", since);

  await signIn(page, email, "mot-de-passe-incorrect");
  await expect(appAlert(page)).toHaveText("Adresse email ou mot de passe incorrect.");
});

test("réinitialisation du mot de passe", async ({ page }) => {
  const email = uniqueEmail("reset");
  await signUpAndVerify(page, email);
  await signOut(page);

  const since = new Date();
  await withFreshClientIp(page);
  await page.goto("/forgot-password");
  await page.getByLabel("Adresse email").fill(email);
  await page.getByRole("button", { name: "Envoyer le lien" }).click();
  await expect(appStatus(page)).toContainText("lien de réinitialisation");

  const link = await waitForEmailLink(email, "Réinitialisation de votre mot de passe", since);
  await page.goto(link);
  await expect(page).toHaveURL(/\/reset-password\?token=/u);
  const newPassword = `nouveau-${randomUUID()}`;
  await page.getByLabel("Nouveau mot de passe").fill(newPassword);
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(appStatus(page)).toContainText("Votre mot de passe est modifié");

  await signIn(page, email);
  await expect(appAlert(page)).toHaveText("Adresse email ou mot de passe incorrect.");
  await signIn(page, email, newPassword);
  await expect(page).toHaveURL(/\/account/u);
});

test("double authentification TOTP et codes de secours", async ({ page }) => {
  const email = uniqueEmail("totp");
  await signUpAndVerify(page, email);
  const { secret, backupCodes } = await enableTwoFactor(page);
  expect(backupCodes).toHaveLength(10);
  await expect(page.getByTestId("two-factor-status")).toHaveText("Active");
  const enableCode = totp(secret);
  await signOut(page);

  // Le mot de passe seul ne suffit plus.
  await signIn(page, email);
  await expect(page).toHaveURL(/\/two-factor/u);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/u);

  // Code TOTP.
  await signIn(page, email);
  await expect(page).toHaveURL(/\/two-factor/u);
  await page.getByLabel("Code").fill(await freshTotp(secret, enableCode));
  await page.getByRole("button", { name: "Vérifier" }).click();
  await expect(page).toHaveURL(/\/account/u);
  await signOut(page);

  // Code de secours, à usage unique.
  for (const attempt of ["accepted", "replayed"] as const) {
    await signIn(page, email);
    await expect(page).toHaveURL(/\/two-factor/u);
    await page.getByRole("button", { name: "Utiliser un code de secours" }).click();
    await page.getByLabel("Code de secours").fill(backupCodes[0]!);
    await page.getByRole("button", { name: "Vérifier" }).click();
    if (attempt === "accepted") {
      await expect(page).toHaveURL(/\/account/u);
      await signOut(page);
    } else {
      await expect(appAlert(page)).toHaveText("Code incorrect.");
    }
  }
});

test("2FA obligatoire à la première connexion pour un owner", async ({ page }) => {
  const email = uniqueEmail("owner");
  await signUpAndVerify(page, email);

  // Le rôle owner est attribué directement en base : les organisations arrivent avec PL-104.
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    const orgId = `org_e2e_${randomUUID()}`;
    await client.query(`INSERT INTO "Organization" (id, name, slug) VALUES ($1, 'E2E', $1)`, [
      orgId,
    ]);
    await client.query(
      `INSERT INTO "Member" (id, "organizationId", "userId", role)
       SELECT $1, $2, id, 'owner' FROM "User" WHERE email = $3`,
      [`mem_${randomUUID()}`, orgId, email],
    );
  } finally {
    await client.end();
  }

  await page.goto("/account");
  await expect(page).toHaveURL(/\/setup-two-factor/u);
  await expect(appAlert(page)).toContainText("obligatoire pour les rôles owner et admin");

  await enableTwoFactor(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mon profil");
});

test("sessions listées et révocables depuis le profil", async ({ browser }) => {
  const email = uniqueEmail("sessions");
  const a = await browser.newPage();
  const b = await browser.newPage({ storageState: undefined });
  try {
    await signUpAndVerify(a, email);
    await signIn(b, email);
    await expect(b).toHaveURL(/\/account/u);

    await a.goto("/account");
    const sessions = a.getByTestId("sessions").locator("li");
    await expect(sessions).toHaveCount(2);
    await expect(a.getByTestId("sessions").locator('li[data-current="true"]')).toContainText(
      "Cette session",
    );

    await a
      .getByTestId("sessions")
      .locator('li[data-current="false"]')
      .getByRole("button", { name: "Fermer" })
      .click();
    await expect(sessions).toHaveCount(1);

    // La session fermée ne donne plus accès à l'espace connecté.
    await b.goto("/account");
    await expect(b).toHaveURL(/\/sign-in/u);
  } finally {
    await a.close();
    await b.close();
  }
});

test("limitation de débit : la 4e tentative de connexion en 10 s depuis une même IP est refusée", async ({
  page,
}) => {
  const email = uniqueEmail("ratelimit");
  await withFreshClientIp(page);
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.goto("/sign-in");
    await page.getByLabel("Adresse email").fill(email);
    await page.getByLabel("Mot de passe").fill("mot-de-passe-incorrect");
    await page.getByRole("button", { name: "Se connecter" }).click();
    // Tentatives 1 à 3 : identifiants refusés (401). Tentative 4 : limite atteinte (429), message générique.
    await expect(appAlert(page)).toHaveText(
      attempt <= 3
        ? "Adresse email ou mot de passe incorrect."
        : "Une erreur est survenue. Réessayez.",
    );
  }
});
