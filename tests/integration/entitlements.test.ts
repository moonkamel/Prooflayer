// PL-602 — Limites de plan et lecture seule, sur base réelle : un système signé passe sous surveillance tant que la
// limite le permet ; au-delà, il reste au registre non surveillé (signature acceptée), sa mise sous surveillance est
// refusée avec proposition de plan, l'arrêt libère une place ; un système non surveillé n'est pas évalué ; limite de
// dépôts ; essai expiré ou impayé : écritures métier refusées, lectures, facturation et organisation ouvertes,
// capture suspendue.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { processDelivery } from "@/server/ingest/process-delivery";
import { createCaller } from "@/server/routers/_app";
import { signClassification } from "@/server/services/classification";
import { assertCanLinkRepository } from "@/server/services/entitlements";
import { evaluateInstance } from "@/server/services/evaluation";
import { recordDelivery } from "@/server/system/webhooks";

const run = randomUUID().slice(0, 8);
const A = `org_ent_${run}`;
const owner = `usr_ent_${run}`;
const INSTALLATION = Number(`7${Date.now() % 1_000_000}`);
const as = () =>
  createCaller({ headers: new Headers(), session: { userId: owner, activeOrganizationId: A } });

/** Système créé et qualifié (haut risque, fournisseur) : brouillon prêt à signer. */
async function qualifiedSystem(name: string) {
  const api = as();
  const { id: systemId } = await api.system.create({
    name,
    intendedPurpose: "Tri",
    ownerUserId: owner,
  });
  await api.classification.draft({ systemId });
  for (const [questionId, value] of [
    ["aiSystem", true],
    ["scope", []],
    ["prohibited", []],
    ["annexI", false],
    ["annexIII", ["4(a)"]],
    ["profiling", true],
    ["developer", false],
    ["art25", []],
  ] as [string, boolean | string[]][]) {
    await api.classification.saveAnswers({ systemId, questionId: questionId as never, value });
  }
  await api.classification.compute({ systemId });
  return systemId;
}

const sign = (systemId: string) =>
  signClassification(
    { headers: new Headers(), userId: owner, orgId: A, role: "owner", db: forOrg(A) },
    { systemId, name: "Clara Martin", title: "CTO", password: "ok", locale: "fr" },
    { verifyPassword: async () => true },
  );

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: "Talvio", slug: A } });
  await prisma.user.create({ data: { id: owner, email: `${owner}@ent.test`, name: "Clara" } });
  await prisma.member.create({
    data: { id: `mem_${owner}`, organizationId: A, userId: owner, role: "owner" },
  });
  // Essai en cours : 1 système surveillé.
  await forOrg(A).subscription.create({
    data: {
      orgId: A,
      plan: "TRIAL",
      status: "trialing",
      monitoredSystemsLimit: 1,
      trialEndsAt: new Date(Date.now() + 7 * 86_400_000),
    },
  });
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "WebhookDelivery" WHERE "deliveryId" LIKE $1`, [
      `ent-${run}-%`,
    ]);
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    for (const table of ["AuditLog", "EvidenceItem", "Classification", "AiSystem"]) {
      await client.query(`DELETE FROM "${table}" WHERE "orgId" = $1`, [A]);
    }
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [owner]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("systèmes surveillés", () => {
  let first = "";
  let second = "";

  it("le premier système signé est surveillé ; le second, au-delà de la limite, reste au registre", async () => {
    first = await qualifiedSystem("Score");
    second = await qualifiedSystem("Tri");
    expect((await sign(first)).monitored).toBe(true);
    // Registre et classification illimités : la signature passe, le système n'est pas surveillé.
    expect((await sign(second)).monitored).toBe(false);
    const after = await forOrg(A).aiSystem.findMany({ select: { id: true, monitored: true } });
    expect(after.find((s) => s.id === first)?.monitored).toBe(true);
    expect(after.find((s) => s.id === second)?.monitored).toBe(false);
  });

  it("un système non surveillé n'est pas évalué", async () => {
    const instance = await forOrg(A).controlInstance.findFirstOrThrow({
      where: { systemId: second },
    });
    const outcome = await withOrgTransaction(A, (tx) =>
      evaluateInstance(tx, A, instance.id, new Date()),
    );
    expect(outcome).toEqual({ evaluated: false, reason: "not_evaluable" });
  });

  it("mise sous surveillance refusée au-delà de la limite ; l'arrêt libère une place, rien n'est supprimé", async () => {
    await expect(as().system.setMonitored({ id: second, monitored: true })).rejects.toThrow(
      "billing.monitoredLimit",
    );
    expect(await as().system.setMonitored({ id: first, monitored: false })).toEqual({
      monitored: false,
    });
    expect(await as().system.setMonitored({ id: second, monitored: true })).toEqual({
      monitored: true,
    });
    expect(await forOrg(A).controlInstance.count({ where: { systemId: first } })).toBeGreaterThan(
      0,
    );
    expect(await forOrg(A).auditLog.count({ where: { action: "system.monitor" } })).toBe(2);
  });

  it("limite de dépôts du plan Starter : 10", async () => {
    await forOrg(A).subscription.update({
      where: { orgId: A },
      data: { plan: "STARTER", status: "active" },
    });
    const integration = await forOrg(A).integration.create({
      data: {
        orgId: A,
        provider: "GITHUB",
        externalAccountId: String(INSTALLATION),
        externalAccountName: "talvio",
        createdByUserId: owner,
      },
    });
    await forOrg(A).integrationResource.createMany({
      data: Array.from({ length: 10 }, (_, i) => ({
        orgId: A,
        integrationId: integration.id,
        kind: "github_repo",
        externalId: `${INSTALLATION}${i}`,
        name: `talvio/repo-${i}`,
        config: {},
      })),
    });
    await expect(withOrgTransaction(A, (tx) => assertCanLinkRepository(tx, A))).rejects.toThrow(
      "billing.repositoryLimit",
    );
    await forOrg(A).subscription.update({ where: { orgId: A }, data: { plan: "GROWTH" } });
    await expect(
      withOrgTransaction(A, (tx) => assertCanLinkRepository(tx, A)),
    ).resolves.toBeUndefined();
  });
});

describe("lecture seule", () => {
  it("essai expiré : écritures métier refusées ; lecture, export, préférences et facturation ouverts", async () => {
    await forOrg(A).subscription.update({
      where: { orgId: A },
      data: { plan: "TRIAL", status: "trialing", trialEndsAt: new Date(Date.now() - 86_400_000) },
    });
    await expect(
      as().system.create({ name: "Nouveau", intendedPurpose: "T", ownerUserId: owner }),
    ).rejects.toThrow("billing.readOnly");
    expect((await as().system.list()).length).toBe(2);
    expect(await as().system.export({ format: "json" } as never)).toBeDefined();
    await expect(
      as().notification.preferences.set({ controlFailedEmail: false, dailyDigestEmail: true }),
    ).resolves.toBeDefined();
    expect((await as().billing.get()).access).toMatchObject({
      kind: "readOnly",
      reason: "trialExpired",
    });
  });

  it("capture suspendue : la livraison GitHub est consignée sans preuve", async () => {
    const deliveryId = `ent-${run}-1`;
    await recordDelivery({
      provider: "GITHUB",
      deliveryId,
      eventType: "pull_request",
      externalAccountId: String(INSTALLATION),
      payload: {
        action: "closed",
        installation: { id: INSTALLATION },
        repository: { id: Number(`${INSTALLATION}0`) },
      },
      rawBody: Buffer.from("{}"),
    });
    expect(await processDelivery("GITHUB", deliveryId)).toBe("ignored");
    const delivery = await prisma.webhookDelivery.findFirstOrThrow({ where: { deliveryId } });
    expect(delivery).toMatchObject({ status: "IGNORED", lastError: "capture suspendue" });
    expect(await forOrg(A).evidenceItem.count()).toBe(
      await forOrg(A).evidenceItem.count({ where: { kind: { startsWith: "system." } } }),
    );
  });
});
