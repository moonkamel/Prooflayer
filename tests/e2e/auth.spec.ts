// PL-103 — Parcours d'authentification de bout en bout, sur une vraie base et le vrai serveur.
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  appAlert,
  appStatus,
  createWorkspace,
  enableTwoFactor,
  nextTotp,
  signIn,
  signOut,
  signUpAndVerify,
  uniqueEmail,
  withFreshClientIp,
} from "./helpers/auth";
import { E2E_PASSWORD } from "./helpers/env";
import { waitForEmailLink } from "./helpers/outbox";

// Parcours en série : chacun ouvre plusieurs sessions et les limites de débit de Better Auth s'appliquent par IP.
// Délai allongé : un parcours avec 2FA peut attendre jusqu'à 30 s une nouvelle fenêtre TOTP avant de se reconnecter.
test.describe.configure({ mode: "serial", timeout: 120_000 });

test("inscription, vérification de l'email, connexion et déconnexion", async ({ page }) => {
  const email = uniqueEmail("signup");
  const { secret } = await createWorkspace(page, email);

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mon profil");
  await expect(page.getByText(email)).toBeVisible();

  await signOut(page);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/u);

  await signIn(page, email, E2E_PASSWORD, secret);
  await expect(page).toHaveURL(/\/account/u);
});

test("connexion refusée avec un mauvais mot de passe ou un email non vérifié", async ({ page }) => {
  const email = uniqueEmail("unverified");
  await withFreshClientIp(page);
  await page.goto("/sign-up");
  await page.getByLabel("Nom complet").fill("Mehdi");
  await page.getByLabel("Nom de l'entreprise").fill("Paylence");
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
  await page.context().clearCookies();

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
  // Connecté ; sans organisation, l'espace connecté mène d'abord à sa création.
  await expect(page).toHaveURL(/\/onboarding/u);
});

test("double authentification TOTP et codes de secours", async ({ page }) => {
  const email = uniqueEmail("totp");
  const { secret, backupCodes } = await createWorkspace(page, email);
  expect(backupCodes).toHaveLength(10);
  await expect(page.getByTestId("two-factor-status")).toHaveText("Active");
  await signOut(page);

  // Le mot de passe seul ne suffit plus.
  await signIn(page, email);
  await expect(page).toHaveURL(/\/two-factor/u);
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in/u);

  // Code TOTP.
  await signIn(page, email);
  await expect(page).toHaveURL(/\/two-factor/u);
  await page.getByLabel("Code").fill(await nextTotp(secret));
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
  await signUpAndVerify(page, email, { company: "Recrutys" });
  await page.getByRole("link", { name: "Continuer" }).click();
  await page.getByRole("button", { name: "Créer mon espace" }).click();

  // Créateur de l'organisation, donc owner : aucun accès avant l'activation de la 2FA.
  await expect(page).toHaveURL(/\/setup-two-factor/u);
  await expect(appAlert(page)).toContainText("obligatoire pour les rôles owner et admin");
  await page.goto("/account");
  await expect(page).toHaveURL(/\/setup-two-factor/u);

  await enableTwoFactor(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Mon profil");
  await expect(page.getByTestId("organizations")).toContainText("Recrutys · Propriétaire");
});

test("sessions listées et révocables depuis le profil", async ({ browser }) => {
  const email = uniqueEmail("sessions");
  const a = await browser.newPage();
  const b = await browser.newPage();
  try {
    const { secret } = await createWorkspace(a, email);
    await signIn(b, email, E2E_PASSWORD, secret);
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
