// PL-109 — Audit axe sans erreur sur la coque (§5.2 : WCAG 2.2 niveau AA), langue et navigation au clavier.
import { expect, test } from "@playwright/test";
import { createWorkspace, signUpAndVerify, uniqueEmail, withFreshClientIp } from "./helpers/auth";
import { expectNoViolations } from "./helpers/a11y";

test.describe.configure({ mode: "serial", timeout: 120_000 });

test("écrans publics : aucune violation WCAG 2.2 AA", async ({ page }) => {
  await withFreshClientIp(page);
  for (const path of [
    "/",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/verify-email",
    "/classifier",
  ]) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }
});

test("espace connecté et écrans d'étape : aucune violation WCAG 2.2 AA", async ({ page }) => {
  const email = uniqueEmail("a11y");
  await signUpAndVerify(page, email, { company: "Accessible" });
  await expectNoViolations(page, "/verify-email (succès)");
  await page.getByRole("link", { name: "Continuer" }).click();
  await expectNoViolations(page, "/onboarding");
  await page.getByRole("button", { name: "Créer mon espace" }).click();
  await expect(page).toHaveURL(/\/setup-two-factor/u);
  await expectNoViolations(page, "/setup-two-factor");
  await page.goto("/account");
  await page.context().clearCookies();

  await createWorkspace(page, uniqueEmail("a11y-owner"), "Accessible SAS");
  for (const path of [
    "/dashboard",
    "/notifications",
    "/account",
    "/organization",
    "/audit",
    "/systems",
  ]) {
    await page.goto(path);
    await expectNoViolations(page, path);
  }

  // Connexion Jira (PL-403) : sans application OAuth configurée, retour sur la page avec un message d'erreur.
  await page.goto("/organization");
  await page.getByRole("link", { name: "Connecter Jira" }).click();
  await expect(page).toHaveURL(/\/organization\?jira=notConfigured$/u);
  await expect(
    page.getByRole("alert").filter({ hasText: "La connexion à Jira n'est pas encore disponible." }),
  ).toBeVisible();
  await expectNoViolations(page, "/organization?jira=notConfigured");
  await page.goto("/systems");

  // Registre (PL-201) : fiche système et ses onglets, champ en cours d'édition compris.
  await page.getByLabel("Nom", { exact: true }).fill("Système accessible");
  await page.getByLabel("Finalité prévue").fill("Vérifier l'accessibilité de la fiche");
  await page.getByRole("button", { name: "Ajouter au registre" }).click();
  await expect(page).toHaveURL(/\/systems\/[^/]+$/u);
  await expectNoViolations(page, "/systems/[id]");
  await page.getByRole("button", { name: "Modifier : Modèles sous-jacents" }).click();
  await page.getByRole("button", { name: "Ajouter un modèle" }).click();
  await expectNoViolations(page, "/systems/[id] (édition)");
  const fiche = new URL(page.url()).pathname;
  for (const tab of ["changes", "history", "classification", "controls", "sources", "dashboard"]) {
    await page.goto(`${fiche}/${tab}`);
    await expectNoViolations(page, `/systems/[id]/${tab}`);
  }
});

test("clavier : le lien d'évitement est le premier élément focalisable et mène au contenu", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Aller au contenu" });
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#contenu$/u);
});

test("langue : le sélecteur bascule l'interface et l'attribut lang du document", async ({
  page,
}) => {
  await page.goto("/sign-in");
  await expect(page.locator("html")).toHaveAttribute("lang", "fr");
  await expect(page).toHaveTitle("Connexion · ProofLayer");
  await page.getByLabel("Langue").selectOption("en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Sign in");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page).toHaveTitle("Sign in · ProofLayer");
  await expectNoViolations(page, "/sign-in (en)");
  await page.getByLabel("Language").selectOption("fr");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Connexion");
});
