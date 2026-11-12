// PL-201 — Registre des systèmes d'IA de bout en bout : création en 3 champs, édition en place, historique
// (avant, après, auteur), modification de conception qualifiée avec motif, export CSV et JSON.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { appStatus, createWorkspace, uniqueEmail } from "./helpers/auth";

test.describe.configure({ mode: "serial", timeout: 150_000 });

const trpcResponse = (page: Page, path: string) =>
  page.waitForResponse(
    (r) => r.url().includes(`/api/trpc/${path}`) && r.request().method() === "POST",
  );

async function download(page: Page, button: string) {
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: button }).click(),
  ]);
  return { name: file.suggestedFilename(), content: await readFile(await file.path(), "utf8") };
}

test("registre : création, édition en place historisée, modification de conception, exports", async ({
  page,
}) => {
  await createWorkspace(page, uniqueEmail("registry-owner"), "Talvio");

  await page
    .getByRole("navigation", { name: "Navigation principale" })
    .getByRole("link", { name: "Systèmes d'IA" })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Registre des systèmes d'IA");
  await expect(page.getByText("Aucun système au registre.")).toBeVisible();

  // Création en 3 champs : nom, finalité prévue, responsable (pré-rempli avec l'utilisateur courant).
  await page.getByLabel("Nom", { exact: true }).fill("Score d'adéquation candidat");
  await page.getByLabel("Finalité prévue").fill("Classe les candidatures par adéquation au poste");
  await page.getByRole("button", { name: "Ajouter au registre" }).click();
  await expect(page).toHaveURL(/\/systems\/[^/]+$/u);
  await expect(page.getByTestId("system-name")).toHaveText("Score d'adéquation candidat");
  await expect(page.getByTestId("system-identity")).toHaveText("Non qualifié");
  await expect(page).toHaveTitle("Score d'adéquation candidat · ProofLayer");

  // Édition en place : cycle de vie, date de mise sur le marché, modèles.
  await page.getByRole("button", { name: "Modifier : Cycle de vie" }).click();
  await page.getByLabel("Cycle de vie").selectOption("PRODUCTION");
  let saved = trpcResponse(page, "system.update");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await saved;
  await expect(page.getByTestId("field-status")).toHaveText("En production");

  await page.getByRole("button", { name: "Modifier : Mise sur le marché ou en service" }).click();
  await page.getByLabel("Mise sur le marché ou en service").fill("2025-03-14");
  saved = trpcResponse(page, "system.update");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await saved;
  await expect(page.getByText("En production depuis le 14/03/2025")).toBeVisible();

  await page.getByRole("button", { name: "Modifier : Modèles sous-jacents" }).click();
  await page.getByRole("button", { name: "Ajouter un modèle" }).click();
  await page.getByLabel("Nom du modèle").fill("claude-sonnet");
  await page.getByLabel("Fournisseur du modèle").fill("Anthropic");
  await page.getByLabel("Modèle d'IA à usage général").check();
  saved = trpcResponse(page, "system.update");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await saved;
  await expect(page.getByTestId("field-models")).toHaveText(
    "claude-sonnet (Anthropic, usage général)",
  );

  // Historique : chaque champ modifié, avec avant et après.
  await page
    .getByRole("navigation", { name: "Sections de la fiche" })
    .getByRole("link", { name: "Historique" })
    .click();
  const status = page.locator('[data-testid="history-entry"][data-field="status"]');
  await expect(status).toContainText("Développement");
  await expect(status).toContainText("En production");
  await expect(
    page.locator('[data-testid="history-entry"][data-action="system.create"]'),
  ).toHaveCount(1);
  await expect(page.locator('[data-testid="history-entry"][data-field="models"]')).toContainText(
    "claude-sonnet",
  );

  // Modification de conception, puis qualification avec motif.
  await page
    .getByRole("navigation", { name: "Sections de la fiche" })
    .getByRole("link", { name: "Changements" })
    .click();
  await page.getByLabel("Date de la modification").fill("2026-03-02");
  await page.getByLabel("Description").fill("Ajout d'un score de pertinence");
  await page.getByRole("button", { name: "Enregistrer" }).click();
  await expect(appStatus(page)).toHaveText("Modification enregistrée.");
  const change = page.getByTestId("design-change");
  await expect(change.getByTestId("design-change-qualification")).toHaveText("À qualifier");
  await change.getByLabel("Significative", { exact: true }).check();
  await change.getByLabel("Motif").fill("Nouvelle finalité : classement des candidatures");
  await change.getByRole("button", { name: "Qualifier" }).click();
  await expect(change.getByTestId("design-change-qualification")).toHaveText("Significative");
  await expect(change).toContainText("Motif : Nouvelle finalité");

  // Exports CSV et JSON du registre.
  await page.goto("/systems");
  await expect(page.getByTestId("registry-row")).toHaveCount(1);
  const csv = await download(page, "Exporter en CSV");
  expect(csv.name).toMatch(/^registre-systemes-ia-\d{4}-\d{2}-\d{2}\.csv$/u);
  expect(csv.content).toContain("Score d'adéquation candidat");
  const json = await download(page, "Exporter en JSON");
  const parsed = JSON.parse(json.content) as {
    systems: { status: string; placedOnMarketAt: string }[];
  };
  expect(parsed.systems).toEqual([
    expect.objectContaining({ status: "PRODUCTION", placedOnMarketAt: "2025-03-14T00:00:00.000Z" }),
  ]);
});
