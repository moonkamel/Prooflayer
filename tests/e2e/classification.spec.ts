// PL-203 — Questionnaire de bout en bout : une question par écran, enregistrement automatique, reprise après
// rechargement, retour arrière, résultat du moteur (objectif démontrable du sprint 2, §9.4).
import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { createWorkspace, uniqueEmail } from "./helpers/auth";

test.describe.configure({ mode: "serial", timeout: 150_000 });

const question = (page: Page) => page.getByTestId("question");
const saved = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.url().includes("/api/trpc/classification.saveAnswers") && r.request().method() === "POST",
  );

async function answer(page: Page, label: string) {
  const done = saved(page);
  await question(page).getByLabel(label, { exact: true }).check();
  await done;
  await page.getByRole("button", { name: "Suivant" }).click();
}

async function expectNoViolations(page: Page, label: string) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(
    violations.map((v) => v.id),
    label,
  ).toEqual([]);
}

test("qualifier « Score d'adéquation candidat » : haut risque, 4(a), fournisseur", async ({
  page,
}) => {
  await createWorkspace(page, uniqueEmail("classify-owner"), "Talvio");
  await page.goto("/systems");
  await page.getByLabel("Nom", { exact: true }).fill("Score d'adéquation candidat");
  await page.getByLabel("Finalité prévue").fill("Classe les candidatures par adéquation au poste");
  await page.getByRole("button", { name: "Ajouter au registre" }).click();
  await page.getByRole("link", { name: "Qualifier ce système" }).click();

  await expect(page.getByText("Question 1 sur 8 environ")).toBeVisible();
  await expect(page.getByRole("link", { name: "Art. 3(1)" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Suivant" })).toBeDisabled();
  await expectNoViolations(page, "questionnaire");
  await answer(page, "Oui");
  await answer(page, "Aucun de ces cas");
  await answer(page, "Aucun de ces cas");

  // Reprise : après rechargement, le questionnaire rouvre la première question sans réponse.
  await page.reload();
  await expect(question(page)).toHaveAttribute("data-question", "annexI");
  await expect(page.getByText("Question 4 sur 8 environ")).toBeVisible();

  // Retour arrière : la réponse précédente est conservée.
  await page.getByRole("button", { name: "Précédent" }).click();
  await expect(question(page)).toHaveAttribute("data-question", "prohibited");
  await expect(question(page).getByLabel("Aucun de ces cas")).toBeChecked();
  await page.getByRole("button", { name: "Suivant" }).click();

  await answer(page, "Non");
  await answer(
    page,
    "4(a) Recrutement et sélection : ciblage d'offres, tri, évaluation de candidats",
  );
  await expect(page.getByText("Question 6 sur 9 environ")).toBeVisible();
  await answer(page, "Oui"); // profilage
  await expect(question(page)).toHaveAttribute("data-question", "developer");
  const done = saved(page);
  await question(page).getByLabel("Oui", { exact: true }).check();
  await done;
  await page.getByRole("button", { name: "Voir le résultat" }).click();

  await expect(page.getByTestId("result-tier")).toHaveText("Haut risque");
  await expect(page.getByTestId("classification-result")).toContainText("4(a)");
  await expect(page.getByTestId("result-role")).toHaveText("Fournisseur");
  await expect(page.getByText("Règles 2026.11.0")).toBeVisible();
  await expectNoViolations(page, "résultat");
});
