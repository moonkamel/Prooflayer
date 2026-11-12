// PL-205 — Dossier d'exemption de bout en bout (§2.2, Recrutys) : classification exemptée signée, dossier rédigé
// puis signé, contrôle AIA-06-02 satisfait, document PDF et champs de l'Annexe VIII section B.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { expectNoViolations } from "./helpers/a11y";
import { createWorkspace, uniqueEmail } from "./helpers/auth";
import { E2E_PASSWORD } from "./helpers/env";

test.describe.configure({ mode: "serial", timeout: 150_000 });

const question = (page: Page) => page.getByTestId("question");

async function answer(page: Page, label: string, next = true) {
  const saved = page.waitForResponse(
    (r) =>
      r.url().includes("/api/trpc/classification.saveAnswers") && r.request().method() === "POST",
  );
  await question(page).getByLabel(label, { exact: true }).check();
  await saved;
  if (next) await page.getByRole("button", { name: "Suivant" }).click();
}

test("Recrutys : exemption signée, dossier signé, Annexe VIII B exportée", async ({ page }) => {
  await createWorkspace(page, uniqueEmail("exemption-owner"), "Recrutys");
  await page.goto("/systems");
  await page.getByLabel("Nom", { exact: true }).fill("Recrutys ATS");
  await page
    .getByLabel("Finalité prévue")
    .fill("Extrait les champs d'un CV et propose des créneaux d'entretien");
  await page.getByRole("button", { name: "Ajouter au registre" }).click();
  await expect(page).toHaveURL(/\/systems\/[^/]+$/u);
  await page.getByRole("button", { name: "Qualifier ce système" }).click();
  await expect(page).toHaveURL(/\/classification$/u);

  await answer(page, "Oui");
  await answer(page, "Aucun de ces cas");
  await answer(page, "Aucun de ces cas");
  await answer(page, "Non");
  await answer(
    page,
    "4(a) Recrutement et sélection : ciblage d'offres, tri, évaluation de candidats",
  );
  await answer(page, "Non");
  await answer(page, "Tâche procédurale étroite (a)");
  await answer(page, "Oui", false);
  await page.getByRole("button", { name: "Voir le résultat" }).click();
  await expect(page.getByTestId("result-tier")).toHaveText("Annexe III, exempté (Art. 6(3))");
  await expect(page.getByTestId("result-controls")).toHaveText(
    "6 contrôles applicables, dont 2 évaluables automatiquement",
  );

  await page.getByRole("button", { name: "Signer la classification" }).click();
  const dialog = page.getByRole("dialog", { name: "Signer la classification" });
  await dialog.getByLabel("Fonction").fill("CTO");
  await dialog.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await dialog.getByRole("button", { name: "Signer", exact: true }).click();
  await expect(page.getByTestId("signature")).toBeVisible();

  // Dossier d'exemption, depuis l'écran A.
  await page.getByRole("link", { name: "Générer le dossier d'exemption" }).click();
  await expect(page).toHaveURL(/\/exemption$/u);
  await expect(page.getByTestId("exemption-classification")).toContainText(
    "condition de l'Art. 6(3) retenue : a",
  );
  await expect(page.getByLabel("Fournisseur : nom")).toHaveValue("Recrutys");
  await expect(page.getByLabel("Nom commercial du système")).toHaveValue("Recrutys ATS");
  await expectNoViolations(page, "dossier d'exemption (brouillon)");

  await page
    .getByLabel("Justification de la condition retenue")
    .fill(
      "Le système extrait les champs d'un CV et propose des créneaux, sans apprécier les candidats.",
    );
  await page
    .getByLabel("Motivation de l'absence de profilage")
    .fill("Aucun score, aucun classement : aucun aspect personnel n'est évalué.");
  await page.getByLabel("Fournisseur : adresse").fill("12 rue de la Paix, 75002 Paris");
  await page.getByLabel("Fournisseur : coordonnées de contact").fill("conformite@recrutys.example");
  await page.getByLabel("France", { exact: true }).check();
  await page.getByRole("button", { name: "Enregistrer le brouillon" }).click();
  await expect(page.getByText("Dossier enregistré.")).toBeVisible();

  await page.getByRole("button", { name: "Signer le dossier" }).click();
  const sign = page.getByRole("dialog", { name: "Signer le dossier" });
  await expect(sign.getByTestId("dossier-statement")).toHaveText(
    "J'atteste l'exactitude des informations de ce dossier et de l'évaluation qu'il documente.",
  );
  await sign.getByLabel("Fonction").fill("CTO");
  await sign.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await sign.getByRole("button", { name: "Signer", exact: true }).click();
  await expect(page.getByTestId("dossier-signature")).toContainText("Clara Martin, CTO");
  await expectNoViolations(page, "dossier d'exemption signé");

  // Document PDF et Annexe VIII section B.
  const pdf = await page.request.get(
    (await page.getByRole("link", { name: "Dossier en PDF" }).getAttribute("href"))!,
  );
  expect(pdf.status()).toBe(200);
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  const [file] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Annexe VIII B en JSON" }).click(),
  ]);
  const annex = JSON.parse(await readFile((await file.path())!, "utf8"));
  expect(annex.fields.find((f: { point: number }) => f.point === 9).value).toEqual(["FR"]);

  // Contrôle AIA-06-02 satisfait par le dossier signé.
  await page
    .getByRole("navigation", { name: "Sections de la fiche" })
    .getByRole("link", { name: "Contrôles 6" })
    .click();
  await expect(
    page.locator('[data-testid="control"][data-key="AIA-06-02"] [data-status]'),
  ).toHaveAttribute("data-status", "PASS");
});
