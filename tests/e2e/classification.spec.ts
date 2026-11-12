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
  await expect(page.getByTestId("result-controls")).toHaveText(
    "37 contrôles applicables, dont 19 évaluables automatiquement",
  );
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

  // Les contrôles sont ouverts dès la signature (objectif démontrable du sprint 2 : « 37 contrôles »).
  await page
    .getByRole("navigation", { name: "Sections de la fiche" })
    .getByRole("link", { name: "Contrôles 37" })
    .click();
  await expect(page.getByTestId("controls-summary")).toHaveText(
    "37 contrôles applicables, dont 19 évaluables automatiquement.",
  );
  await expect(page.getByTestId("control")).toHaveCount(37);
  await expect(page.locator('[data-testid="control"][data-key="AIA-15-02"]')).toContainText(
    "PR approuvées par un tiers",
  );
  await expectNoViolations(page, "contrôles");

  // Preuve déclarative (PL-405) : attestation signée sur la revue annuelle des pratiques interdites (AIA-05-01).
  await page.getByRole("link", { name: "Ajouter une preuve · AIA-05-01" }).click();
  await expect(page.getByRole("heading", { name: "Ajouter une preuve" })).toBeVisible();
  await expectNoViolations(page, "ajout d'une preuve");
  const attestation = page.getByTestId("attest-form");
  await attestation
    .getByLabel("Déclaration")
    .fill("J'atteste qu'aucune pratique interdite par l'Art. 5 n'a été identifiée.");
  await attestation.getByLabel("Nom du signataire").fill("Clara Martin");
  await attestation.getByLabel("Fonction").fill("CTO");
  await attestation
    .getByLabel("Valable jusqu'au")
    .fill(new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10));
  await attestation.getByLabel("Mot de passe").fill(E2E_PASSWORD);
  await attestation.getByRole("button", { name: "Signer l'attestation" }).click();
  await expect(page).toHaveURL(/\/controls$/u);

  // Dashboard (PL-406) : 37 contrôles, filtres reflétés dans l'adresse et conservés au rechargement.
  await page.goto(page.url().replace(/\/controls$/u, "/dashboard"));
  await expect(page.getByTestId("dashboard-control")).toHaveCount(37);
  await expect(page.getByTestId("results")).toHaveText("37 contrôles affichés");
  await page.getByLabel("Rechercher un contrôle").fill("AIA-15-02");
  await expect(page.getByTestId("dashboard-control")).toHaveCount(1);
  await expect(page).toHaveURL(/[?&]q=AIA-15-02/u);
  await page.reload();
  await expect(page.getByTestId("dashboard-control")).toHaveCount(1);
  await expectNoViolations(page, "dashboard filtré");
  await page.getByRole("button", { name: "Réinitialiser les filtres" }).click();
  await expect(page.getByTestId("dashboard-control")).toHaveCount(37);

  // Détail d'un contrôle (PL-407, écran D) : preuve attendue, responsable, commentaire, non-applicabilité justifiée.
  await page.getByRole("link", { name: /AIA-15-02/u }).click();
  await expect(
    page.getByRole("heading", { level: 2, name: "PR approuvées par un tiers" }),
  ).toBeVisible();
  await expect(page.getByTestId("expected")).toBeVisible();
  await expectNoViolations(page, "détail d'un contrôle");
  const owner = page.getByTestId("owner-form");
  await owner.getByLabel("Responsable du contrôle").selectOption({ index: 1 });
  await owner.getByRole("button", { name: "Assigner" }).click();
  await expect(owner.getByText("Responsable enregistré.")).toBeVisible();
  await expect(page.getByTestId("control-owner")).not.toHaveText("Aucun responsable assigné.");
  const comment = page.getByTestId("comment-form");
  await comment
    .getByLabel("Ajouter un commentaire")
    .fill("Branche protégée en cours de configuration.");
  await comment.getByRole("button", { name: "Commenter" }).click();
  await expect(page.getByTestId("comments")).toContainText(
    "Branche protégée en cours de configuration.",
  );
  const na = page.getByTestId("na-form");
  await na
    .getByLabel("Justification de la non-applicabilité")
    .fill("Le dépôt est géré hors GitHub pendant la phase pilote.");
  await na.getByRole("button", { name: "Déclarer non applicable" }).click();
  await expect(page.getByTestId("control-status")).toHaveText("Non applicable");
  await expectNoViolations(page, "contrôle non applicable");
  await na.getByRole("button", { name: "Rouvrir le contrôle" }).click();
  await expect(page.getByTestId("control-status")).toHaveText("Sans preuve");
  await page.goto(page.url().replace(/\/controls\/.*$/u, "/classification"));

  // Requalification : les réponses de la version signée sont reprises ; elle reste en vigueur et visible.
  await page.getByRole("button", { name: "Requalifier le système" }).click();
  await expect(question(page)).toHaveAttribute("data-question", "aiSystem");
  await expect(question(page).getByLabel("Oui", { exact: true })).toBeChecked();
  await expect(page.getByText("Une requalification est en cours.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Version signée en vigueur" })).toBeVisible();
  await expect(page.getByTestId("classification-version")).toHaveCount(1);
  await expectNoViolations(page, "requalification en cours");
});
