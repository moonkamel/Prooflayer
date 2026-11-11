// PL-104 — Organisations, invitations et rôles, de bout en bout.
import { expect, test, type Page } from "@playwright/test";
import pg from "pg";
import {
  appAlert,
  appStatus,
  createWorkspace,
  enableTwoFactor,
  signUpAndVerify,
  uniqueEmail,
} from "./helpers/auth";
import { waitForEmailLink } from "./helpers/outbox";

// Chaque parcours crée plusieurs comptes avec 2FA (attente d'une nouvelle fenêtre TOTP) : délai allongé.
test.describe.configure({ mode: "serial", timeout: 150_000 });

/** Réponse de l'appel tRPC `path` déclenché par l'interface, pour ne pas naviguer avant qu'il soit terminé. */
const trpcResponse = (page: Page, path: string) =>
  page.waitForResponse(
    (r) => r.url().includes(`/api/trpc/${path}`) && r.request().method() === "POST",
  );

/** Sélecteur de rôle du formulaire d'invitation (nom accessible : « Rôle » suivi de l'option affichée). */
const inviteRoleSelect = (page: Page) => page.getByRole("combobox", { name: /^Rôle/u });

async function invite(
  owner: Page,
  email: string,
  role: "Administrateur" | "Contributeur" | "Auditeur",
) {
  const since = new Date();
  await owner.goto("/organization");
  await owner.getByLabel("Adresse email").fill(email);
  await inviteRoleSelect(owner).selectOption({ label: role });
  await owner.getByRole("button", { name: "Envoyer l'invitation" }).click();
  await expect(appStatus(owner)).toHaveText(`Invitation envoyée à ${email}.`);
  return waitForEmailLink(email, "Invitation à rejoindre", since);
}

/** L'invité suit le lien, crée son compte depuis l'invitation, vérifie son adresse et accepte. */
async function joinFromInvitation(page: Page, link: string, email: string) {
  const path = new URL(link).pathname;
  await page.goto(link);
  await expect(page.getByRole("link", { name: "Créer un compte pour accepter" })).toBeVisible();
  await signUpAndVerify(page, email, { name: "Sophie Ferrand", next: path });
  await page.getByRole("link", { name: "Continuer" }).click();
  await expect(page).toHaveURL(new RegExp(path, "u"));
  await page.getByRole("button", { name: "Accepter l'invitation" }).click();
  await expect(page).toHaveURL(/\/account/u);
}

test("création de l'organisation à l'inscription, invitation d'un contributeur et rôles appliqués", async ({
  page,
  browser,
}) => {
  const ownerEmail = uniqueEmail("org-owner");
  await createWorkspace(page, ownerEmail, "Talvio");
  await expect(page.getByTestId("organizations")).toContainText("Talvio · Propriétaire");

  const contributorEmail = uniqueEmail("org-contributor");
  const link = await invite(page, contributorEmail, "Contributeur");
  expect(link).toMatch(/\/accept-invitation\//u);
  await expect(page.getByTestId("invitation")).toContainText(contributorEmail);

  const contributor = await browser.newPage();
  try {
    await joinFromInvitation(contributor, link, contributorEmail);
    // Contributeur : pas de 2FA imposée, accès direct au profil.
    await expect(contributor.getByRole("heading", { level: 1 })).toHaveText("Mon profil");
    await expect(contributor.getByTestId("organizations")).toContainText("Talvio · Contributeur");

    // L'écran Organisation est en lecture seule pour un contributeur.
    await contributor.goto("/organization");
    await expect(contributor.getByRole("button", { name: "Envoyer l'invitation" })).toHaveCount(0);
    await expect(contributor.getByRole("button", { name: "Retirer" })).toHaveCount(0);
    await expect(contributor.getByTestId("member")).toHaveCount(2);

    // Côté owner : l'invitation a disparu des invitations en attente, le membre est listé.
    await page.goto("/organization");
    await expect(page.getByTestId("invitation")).toHaveCount(0);
    const row = page.locator(`[data-testid="member"][data-email="${contributorEmail}"]`);
    await expect(row.getByLabel("Modifier le rôle")).toHaveValue("contributor");

    // Promu admin, le membre doit activer la 2FA avant tout accès (§3.2 E10).
    const roleSaved = trpcResponse(page, "org.members.setRole");
    await row.getByLabel("Modifier le rôle").selectOption("admin");
    expect((await roleSaved).ok()).toBe(true);
    await contributor.goto("/account");
    await expect(contributor).toHaveURL(/\/setup-two-factor/u);
    await enableTwoFactor(contributor);
    await expect(contributor.getByTestId("organizations")).toContainText("Talvio · Administrateur");

    // Retiré de l'organisation, il perd l'accès à l'espace connecté.
    await page.goto("/organization");
    const removed = trpcResponse(page, "org.members.remove");
    await page
      .locator(`[data-testid="member"][data-email="${contributorEmail}"]`)
      .getByRole("button", { name: "Retirer" })
      .click();
    expect((await removed).ok()).toBe(true);
    await expect(page.getByTestId("member")).toHaveCount(1);
    await contributor.goto("/organization");
    await expect(contributor).toHaveURL(/\/onboarding/u);
  } finally {
    await contributor.close();
  }
});

test("invitation valable 7 jours et révocable", async ({ page, browser }) => {
  await createWorkspace(page, uniqueEmail("revoke-owner"), "Paylence");
  const inviteeEmail = uniqueEmail("revoked");
  const link = await invite(page, inviteeEmail, "Auditeur");

  // Échéance à 7 jours (§3.2 E10).
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ days: number }>(
      `SELECT extract(epoch FROM ("expiresAt" - "createdAt")) / 86400 AS days
       FROM "Invitation" WHERE email = $1`,
      [inviteeEmail],
    );
    expect(Number(rows[0]?.days)).toBeCloseTo(7, 2);
  } finally {
    await client.end();
  }

  await page.getByRole("button", { name: "Révoquer" }).click();
  await expect(page.getByText("Aucune invitation en attente.")).toBeVisible();

  const invitee = await browser.newPage();
  try {
    await invitee.goto(link);
    await signUpAndVerify(invitee, inviteeEmail, { next: new URL(link).pathname });
    await invitee.getByRole("link", { name: "Continuer" }).click();
    await expect(appAlert(invitee)).toContainText("invalide, expirée, révoquée");
    await expect(invitee.getByRole("button", { name: "Accepter l'invitation" })).toHaveCount(0);
  } finally {
    await invitee.close();
  }
});

test("un admin ne peut ni attribuer le rôle owner ni toucher à un owner", async ({
  page,
  browser,
}) => {
  await createWorkspace(page, uniqueEmail("guard-owner"), "Garde");
  const adminEmail = uniqueEmail("guard-admin");
  const link = await invite(page, adminEmail, "Administrateur");

  const admin = await browser.newPage();
  try {
    await joinFromInvitation(admin, link, adminEmail);
    await expect(admin).toHaveURL(/\/setup-two-factor/u);
    await enableTwoFactor(admin);

    await admin.goto("/organization");
    // Le rôle owner n'est pas proposé à l'invitation, et la ligne de l'owner n'est pas modifiable.
    await expect(inviteRoleSelect(admin).locator("option")).toHaveText([
      "Administrateur",
      "Contributeur",
      "Auditeur",
    ]);
    const ownerRow = admin.getByTestId("member").filter({ hasText: "Propriétaire" });
    await expect(ownerRow.getByRole("button", { name: "Retirer" })).toHaveCount(0);
  } finally {
    await admin.close();
  }
});

test("changement d'organisation active", async ({ page, browser }) => {
  const userEmail = uniqueEmail("switch");
  const { secret } = await createWorkspace(page, userEmail, "Alpha");

  // Un autre owner invite cet utilisateur dans une seconde organisation.
  const other = await browser.newPage();
  let link: string;
  try {
    await createWorkspace(other, uniqueEmail("switch-other"), "Beta");
    link = await invite(other, userEmail, "Auditeur");
  } finally {
    await other.close();
  }
  expect(secret).toBeTruthy();

  await page.goto(link);
  await page.getByRole("button", { name: "Accepter l'invitation" }).click();
  await expect(page).toHaveURL(/\/account/u);

  const orgs = page.getByTestId("organizations").locator("li");
  await expect(orgs).toHaveCount(2);
  // L'organisation rejointe devient active.
  await expect(orgs.filter({ hasText: "Beta" })).toHaveAttribute("data-active", "true");
  await page.goto("/organization");
  await expect(page.getByTestId("org-name")).toHaveText("Beta");

  await page.goto("/account");
  await orgs.filter({ hasText: "Alpha" }).getByRole("button", { name: "Basculer" }).click();
  await expect(orgs.filter({ hasText: "Alpha" })).toHaveAttribute("data-active", "true");
  await page.goto("/organization");
  await expect(page.getByRole("button", { name: "Renommer" })).toBeVisible();
  await expect(page.getByLabel("Nom", { exact: true })).toHaveValue("Alpha");
});
