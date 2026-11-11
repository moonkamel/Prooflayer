// PL-106 — Journal d'audit de bout en bout : chaque écriture faite dans l'interface y figure,
// la consultation est filtrable et exportable en CSV, et réservée aux rôles owner et admin.
import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { appAlert, appStatus, createWorkspace, signUpAndVerify, uniqueEmail } from "./helpers/auth";
import { waitForEmailLink } from "./helpers/outbox";

test.describe.configure({ mode: "serial", timeout: 150_000 });

const trpcResponse = (page: Page, path: string) =>
  page.waitForResponse(
    (r) => r.url().includes(`/api/trpc/${path}`) && r.request().method() === "POST",
  );

async function invite(owner: Page, email: string) {
  const since = new Date();
  await owner.goto("/organization");
  await owner.getByLabel("Adresse email").fill(email);
  await owner.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(appStatus(owner)).toHaveText(`Invitation envoyée à ${email}.`);
  return waitForEmailLink(email, "Invitation à rejoindre", since);
}

test("chaque écriture est journalisée, filtrable et exportable ; journal refusé à un auditeur", async ({
  page,
  browser,
}) => {
  const ownerEmail = uniqueEmail("audit-owner");
  await createWorkspace(page, ownerEmail, "Journal SAS");

  // Écritures : invitation acceptée, changement de rôle, invitation révoquée, renommage.
  const memberEmail = uniqueEmail("audit-member");
  const link = await invite(page, memberEmail);
  const member = await browser.newPage();
  try {
    await member.goto(link);
    await signUpAndVerify(member, memberEmail, { next: new URL(link).pathname });
    await member.getByRole("link", { name: "Continuer" }).click();
    await member.getByRole("button", { name: "Accepter l'invitation" }).click();
    await expect(member).toHaveURL(/\/account/u);

    await page.goto("/organization");
    const row = page.locator(`[data-testid="member"][data-email="${memberEmail}"]`);
    const roleSaved = trpcResponse(page, "org.members.setRole");
    await row.getByLabel("Modifier le rôle").selectOption("auditor");
    expect((await roleSaved).ok()).toBe(true);

    await invite(page, uniqueEmail("audit-revoked"));
    const revoked = trpcResponse(page, "org.members.revokeInvitation");
    await page.getByRole("button", { name: "Révoquer" }).click();
    expect((await revoked).ok()).toBe(true);

    await page.goto("/organization");
    await page.getByLabel("Nom", { exact: true }).fill("Journal SA");
    const renamed = trpcResponse(page, "org.update");
    await page.getByRole("button", { name: "Renommer" }).click();
    expect((await renamed).ok()).toBe(true);

    // Consultation : une entrée par écriture, la plus récente en tête, acteur nommé.
    await page.goto("/organization");
    await page.getByRole("link", { name: "Journal d'audit" }).click();
    await expect(page).toHaveURL(/\/audit/u);
    const entries = page.getByTestId("audit-entry");
    const actions = await entries.evaluateAll((rows) =>
      rows.map((r) => r.getAttribute("data-action")),
    );
    expect(actions).toEqual([
      "organization.update",
      "invitation.revoke",
      "member.invite",
      "member.setRole",
      "invitation.accept",
      "member.invite",
      "organization.create",
    ]);
    await expect(entries.first()).toContainText(ownerEmail);
    await expect(entries.filter({ hasText: "Acceptation d'une invitation" })).toContainText(
      memberEmail,
    );

    // Filtre par action.
    await page.getByLabel("Action").selectOption({ label: "Invitation d'un membre" });
    await page.getByRole("button", { name: "Filtrer" }).click();
    await expect(page).toHaveURL(/action=member\.invite/u);
    await expect(entries).toHaveCount(2);

    // Export CSV des entrées filtrées.
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Exporter en CSV" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^journal-audit-\d{4}-\d{2}-\d{2}\.csv$/u);
    const csv = await readFile(await file.path(), "utf8");
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe(
      "date_utc,actor_type,actor,action,target_type,target_id,metadata,ip_address",
    );
    expect(lines).toHaveLength(3);
    expect(lines.slice(1).every((l) => l.includes(",member.invite,"))).toBe(true);
    expect(csv).toContain(ownerEmail);

    // Un auditeur (lecture seule) n'a pas accès au journal d'audit.
    await member.goto("/audit");
    await expect(appAlert(member)).toHaveText(
      "Le journal d'audit est réservé aux rôles propriétaire et administrateur.",
    );
    await expect(member.getByTestId("audit-log")).toHaveCount(0);
  } finally {
    await member.close();
  }
});
