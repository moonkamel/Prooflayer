// PL-606 — Pages légales et centre de confiance, sans configuration de l'éditeur (cas de l'environnement de test) :
// documents publiés mais signalés incomplets, aucune identité inventée ; security.txt et pack public absents.
import { expect, test } from "@playwright/test";
import { withFreshClientIp } from "./helpers/auth";

test("pied de page → conditions générales, signalées incomplètes sans identité de l'éditeur", async ({
  page,
}) => {
  await withFreshClientIp(page);
  await page.goto("/sign-in");
  await page
    .getByRole("navigation", { name: "Informations légales" })
    .getByRole("link", { name: "Conditions générales" })
    .click();
  await expect(page).toHaveURL(/\/legal\/terms$/u);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Conditions générales d'utilisation et de vente",
  );
  await expect(page.getByRole("status")).toContainText("raison sociale");
  await expect(page.getByText("2. Absence de conseil juridique")).toBeVisible();
  await expect(page.getByText("[à compléter]").first()).toBeVisible();
});

test("contrat de sous-traitance : sous-traitants ultérieurs listés", async ({ page }) => {
  await page.goto("/legal/dpa");
  const table = page.getByRole("table", { name: "Sous-traitants ultérieurs" });
  await expect(table.getByRole("row")).toHaveCount(7);
  await expect(table).toContainText("Supabase");
});

test("document inconnu : 404", async ({ page }) => {
  expect((await page.goto("/legal/autre"))?.status()).toBe(404);
});

test("centre de confiance ; security.txt et pack public absents sans configuration", async ({
  page,
  request,
}) => {
  await page.goto("/trust");
  await expect(page.getByRole("heading", { name: "Le pack d'audit de ProofLayer" })).toBeVisible();
  await expect(page.getByText("Le pack public n'est pas encore publié.")).toBeVisible();
  expect((await request.get("/.well-known/security.txt")).status()).toBe(404);
  expect((await request.get("/api/public/pack")).status()).toBe(404);
});
