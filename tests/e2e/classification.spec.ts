// PL-203 — Questionnaire de bout en bout : une question par écran, enregistrement automatique, reprise après
// rechargement, retour arrière, résultat du moteur (objectif démontrable du sprint 2, §9.4).
import { expect, test, type Page } from "@playwright/test";
import { expectNoViolations } from "./helpers/a11y";
import { createWorkspace, uniqueEmail } from "./helpers/auth";
import { E2E_PASSWORD } from "./helpers/env";

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

test("qualifier « Score d'adéquation candidat » : haut risque, 4(a), fournisseur", async ({
  page,
}) => {
  await createWorkspace(page, uniqueEmail("classify-owner"), "Talvio");
  await page.goto("/systems");
  await page.getByLabel("Nom", { exact: true }).fill("Score d'adéquation candidat");
  await page.getByLabel("Finalité prévue").fill("Classe les candidatures par adéquation au poste");
  await page.getByRole("button", { name: "Ajouter au registre" }).click();
  await expect(page).toHaveURL(/\/systems\/[^/]+$/u);
  // Afficher la page de classification ne crée rien : le brouillon naît d'une action explicite.
  await page.goto(`${new URL(page.url()).pathname}/classification`);
  await expect(page.getByText("Ce système n'est pas encore qualifié.")).toBeVisible();
  const breadcrumb = page.getByRole("navigation", { name: "Fil d'Ariane" });
  await expect(breadcrumb.getByRole("link", { name: "Registre" })).toBeVisible();
  await expect(breadcrumb.getByText("Classification")).toHaveAttribute("aria-current", "page");
  await breadcrumb.getByRole("link", { name: "Score d'adéquation candidat" }).click();
  await page.getByRole("button", { name: "Qualifier ce système" }).click();
  await expect(page).toHaveURL(/\/classification$/u);

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

  // Écran A : bandeau, trace de raisonnement, implications.
  await expect(page.getByTestId("result-tier")).toHaveText("Haut risque");
  await expect(page.getByTestId("classification-result")).toContainText("Annexe III, point 4(a)");
  await expect(page.getByTestId("result-role")).toHaveText("Rôle : Fournisseur");
  await expect(page.getByText("Règles v2026.11.0 · Brouillon non signé")).toBeVisible();
  const reasoning = page.getByTestId("reasoning");
  await expect(reasoning.getByRole("listitem")).toHaveCount(6);
  const profiling = reasoning.getByRole("listitem").filter({
    hasText: "Profilage de personnes physiques : l'Art. 6(3) ne s'applique pas, haut risque",
  });
  await profiling.locator("summary").click();
  await expect(profiling.getByText("Votre réponse : Oui")).toBeVisible();
  await expect(profiling.getByRole("link", { name: "Art. 6(3), dernier alinéa" })).toBeVisible();
  await expect(page.getByText("Application : 2 décembre 2027 · Art. 113")).toBeVisible();
  await expect(
    page.getByText("Évaluation : contrôle interne · Art. 43(2), Annexe VI"),
  ).toBeVisible();
  await expectNoViolations(page, "résultat");

  // Note PDF du brouillon.
  const note = await page.request.get(
    (await page.getByRole("link", { name: "Note en PDF" }).getAttribute("href"))!,
  );
  expect(note.status()).toBe(200);
  expect(note.headers()["content-type"]).toBe("application/pdf");
  expect((await note.body()).subarray(0, 5).toString()).toBe("%PDF-");

  // Signature : nom, fonction, déclaration, mot de passe.
  await page.getByRole("button", { name: "Signer la classification" }).click();
  const dialog = page.getByRole("dialog", { name: "Signer la classification" });
  await expect(dialog.getByTestId("statement")).toHaveText(
    "J'atteste l'exactitude des réponses fournies.",
  );
  await expectNoViolations(page, "fenêtre de signature");
  await dialog.getByLabel("Fonction").fill("CTO");
  await dialog.getByLabel("Mot de passe").fill("mauvais-mot-de-passe");
  await dialog.getByRole("button", { name: "Signer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText("Mot de passe incorrect.");
  await dialog.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await dialog.getByRole("button", { name: "Signer", exact: true }).click();

  await expect(page.getByTestId("signature")).toContainText("Clara Martin, CTO");
  await expect(page.getByTestId("classification-version")).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Signer la classification" })).toHaveCount(0);
  await expect(page.getByTestId("system-identity")).toHaveText("Haut risque · 4(a) · Fournisseur");
  await expectNoViolations(page, "classification signée");

  // Requalification : les réponses de la version signée sont reprises ; elle reste en vigueur et visible.
  await page.getByRole("button", { name: "Requalifier le système" }).click();
  await expect(question(page)).toHaveAttribute("data-question", "aiSystem");
  await expect(question(page).getByLabel("Oui", { exact: true })).toBeChecked();
  await expect(page.getByText("Une requalification est en cours.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Version signée en vigueur" })).toBeVisible();
  await expect(page.getByTestId("classification-version")).toHaveCount(1);
  await expectNoViolations(page, "requalification en cours");
});
