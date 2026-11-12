// PL-208 — Classifieur public de bout en bout : sans compte, même moteur, lien partageable avec réponses
// préremplies, note PDF envoyée contre une adresse professionnelle avec consentement explicite et facultatif.
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";
import { expectNoViolations } from "./helpers/a11y";
import { withFreshClientIp } from "./helpers/auth";
import { waitForEmail } from "./helpers/outbox";

test.describe.configure({ mode: "serial", timeout: 120_000 });

const question = (page: Page) => page.getByTestId("question");

async function answer(page: Page, label: string, next = true) {
  await question(page).getByLabel(label, { exact: true }).check();
  if (next) await page.getByRole("button", { name: "Suivant" }).click();
}

test("classer sans compte, partager le lien, recevoir la note", async ({ page, browser }) => {
  await withFreshClientIp(page);
  await page.goto("/");
  await page.getByRole("link", { name: "Classifier un système sans compte" }).click();
  await expect(page).toHaveURL(/\/classifier$/u);
  await expect(page).toHaveTitle("Classifier un système d'IA · ProofLayer");

  await answer(page, "Oui");
  await answer(page, "Aucun de ces cas");
  await answer(page, "Aucun de ces cas");
  await answer(page, "Non");
  await answer(
    page,
    "4(a) Recrutement et sélection : ciblage d'offres, tri, évaluation de candidats",
  );
  await answer(page, "Oui");
  await answer(page, "Oui", false);
  await page.getByRole("button", { name: "Voir le résultat" }).click();

  const result = page.getByTestId("public-result");
  await expect(result.getByTestId("result-tier")).toHaveText("Haut risque");
  await expect(result).toContainText("Annexe III, point 4(a)");
  await expect(result.getByTestId("result-role")).toHaveText("Rôle : Fournisseur");
  await expectNoViolations(page, "/classifier (résultat)");

  // Lien partageable : un autre visiteur voit le même résultat, sans répondre.
  const shareUrl = await page.getByTestId("share-link").inputValue();
  expect(shareUrl).toMatch(/\/classifier\?r=[A-Za-z0-9_-]+$/u);
  const visitor = await browser.newPage();
  try {
    await visitor.goto(new URL(shareUrl).pathname + new URL(shareUrl).search);
    await expect(visitor.getByTestId("result-tier")).toHaveText("Haut risque");
  } finally {
    await visitor.close();
  }

  // Note PDF : refusée pour une messagerie grand public, envoyée pour une adresse professionnelle.
  await page.getByLabel("Adresse email professionnelle").fill("quelquun@gmail.com");
  await page.getByRole("button", { name: "Recevoir la note" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toHaveText(
    "Indiquez une adresse professionnelle : les messageries grand public ne sont pas acceptées.",
  );
  const email = `cto-${randomUUID().slice(0, 8)}@talvio.example`;
  const since = new Date();
  await page.getByLabel("Nom du système (facultatif)").fill("Score d'adéquation candidat");
  await page.getByLabel("Adresse email professionnelle").fill(email);
  const consent = page.getByLabel(/J'accepte que ProofLayer me recontacte/u);
  await expect(consent).not.toBeChecked();
  await consent.check();
  await page.getByRole("button", { name: "Recevoir la note" }).click();
  await expect(page.getByText(`Note envoyée à ${email}.`)).toBeVisible();

  const mail = await waitForEmail(email, "Note de classification AI Act", since);
  expect(mail.attachments?.[0]?.contentType).toBe("application/pdf");
  expect(Buffer.from(mail.attachments![0]!.contentBase64, "base64").subarray(0, 5).toString()).toBe(
    "%PDF-",
  );
});
