// PL-408 — Alertes sur base réelle : régression PASS → FAIL (notification au responsable, à défaut au responsable du
// système, email immédiat une seule fois, rien si le contrôle s'est rétabli ou si la préférence est coupée) ; résumé
// quotidien (un email par utilisateur, organisations réunies, contenu selon le rôle, jamais deux fois le même jour) ;
// programmation quotidienne dédupliquée ; routeur `notification`.
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import type { EmailMessage } from "@/server/email/transport";
import { LIBRARY_VERSION } from "@/server/rules/library";
import type { EvaluatorRegistry } from "@/server/rules/engine";
import { createCaller } from "@/server/routers/_app";
import { evaluateInstance } from "@/server/services/evaluation";
import {
  sendDailyDigest,
  sendNotificationEmail,
  type NotificationDependencies,
} from "@/server/services/notifications";
import { scheduleDailyDigests } from "@/server/system/notification-schedule";

const run = randomUUID().slice(0, 8);
const A = `org_ntf_a_${run}`;
const B = `org_ntf_b_${run}`;
const alice = `usr_ntf_alice_${run}`; // owner de A, contributrice de B
const bob = `usr_ntf_bob_${run}`; // contributeur de A, responsable de système
const ids: Record<string, string> = {};
let systemA = "";
let systemB = "";
const day = new Date().toISOString().slice(0, 10);
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
const as = (userId: string, orgId = A) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: orgId } });

function fakeDeps(): NotificationDependencies & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    transport: { send: async (m) => void sent.push(m) },
    baseUrl: "https://app.example.test",
    now: () => new Date(),
  };
}

/** Évaluateur de test : le statut voulu, sans preuve. */
const forced = (status: "PASS" | "FAIL"): EvaluatorRegistry => ({
  "github.peerReview": {
    version: "test@1",
    evaluate: () => ({
      status,
      reasons: [
        { code: "T", message: { fr: `Raison ${status}`, en: `Reason ${status}` }, evidenceIds: [] },
      ],
      evidenceIds: [],
    }),
  },
});

const evaluateAs = (status: "PASS" | "FAIL", instance = ids.peerA!) =>
  withOrgTransaction(A, (tx) => evaluateInstance(tx, A, instance, new Date(), forced(status)));

beforeAll(async () => {
  for (const org of [A, B]) {
    await prisma.organization.create({
      data: { id: org, name: `Org ${org.slice(8, 9)}`, slug: org },
    });
  }
  await prisma.user.create({
    data: { id: alice, email: `${alice}@ntf.test`, name: "Alice", locale: "fr" },
  });
  await prisma.user.create({
    data: { id: bob, email: `${bob}@ntf.test`, name: "Bob", locale: "en" },
  });
  for (const [id, org, userId, role] of [
    [`mem_${alice}_a`, A, alice, "owner"],
    [`mem_${alice}_b`, B, alice, "contributor"],
    [`mem_${bob}_a`, A, bob, "contributor"],
  ] as const) {
    await prisma.member.create({ data: { id, organizationId: org, userId, role } });
  }
  systemA = (
    await forOrg(A).aiSystem.create({
      data: {
        monitored: true,
        orgId: A,
        name: "Score",
        slug: `score-${run}`,
        intendedPurpose: "T",
        ownerUserId: bob,
        models: [],
      },
    })
  ).id;
  systemB = (
    await forOrg(B).aiSystem.create({
      data: {
        monitored: true,
        orgId: B,
        name: "Tri",
        slug: `tri-${run}`,
        intendedPurpose: "T",
        ownerUserId: alice,
        models: [],
      },
    })
  ).id;
  const definitions = await prisma.controlDefinition.findMany({
    where: { key: { in: ["AIA-15-02", "AIA-05-01"] }, libraryVersion: LIBRARY_VERSION },
  });
  const def = (key: string) => definitions.find((d) => d.key === key)!.id;
  ids.peerA = (
    await forOrg(A).controlInstance.create({
      data: { orgId: A, systemId: systemA, definitionId: def("AIA-15-02") },
    })
  ).id;
  ids.attestB = (
    await forOrg(B).controlInstance.create({
      data: { orgId: B, systemId: systemB, definitionId: def("AIA-05-01"), ownerUserId: alice },
    })
  ).id;
  // B : une attestation qui expire dans 5 jours, rattachée au contrôle dont Alice est responsable.
  // A : un connecteur révoqué et une classification à revoir.
  const client = direct();
  await client.connect();
  try {
    await client.query(
      `INSERT INTO "EvidenceItem" (id, "orgId", kind, source, "capturedVia", "sourceRef", "dedupeKey", "occurredAt",
         summary, "contentSha256", "leafHash", declarative, "validUntil")
       VALUES ($1, $2, 'manual.attestation', 'MANUAL', 'ATTESTATION', 'r', $1, now(), 'Revue annuelle Art. 5',
         decode(md5('a') || md5('a'), 'hex'), decode(md5('a') || md5('a'), 'hex'), true, now() + interval '5 days')`,
      [`ev_ntf_${run}`, B],
    );
    await client.query(
      `INSERT INTO "EvidenceLink" ("evidenceId", "controlInstanceId", "orgId", "linkedBy") VALUES ($1, $2, $3, $4)`,
      [`ev_ntf_${run}`, ids.attestB, B, alice],
    );
    await client.query(
      `INSERT INTO "Integration" (id, "orgId", provider, "externalAccountId", "externalAccountName", status, scopes,
         "createdByUserId")
       VALUES ($1, $2, 'JIRA', $1, 'Site', 'REVOKED', '{}', $3)`,
      [`int_ntf_${run}`, A, alice],
    );
    await client.query(`UPDATE "AiSystem" SET "classificationStale" = true WHERE id = $1`, [
      systemA,
    ]);
  } finally {
    await client.end();
  }
});

afterAll(async () => {
  const client = direct();
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = ANY($1) OR "dedupeKey" LIKE $2`, [
      [A, B],
      "notification.digest:%:2099-01-02",
    ]);
    await client.query(`DELETE FROM "Notification" WHERE "orgId" = ANY($1)`, [[A, B]]);
    await client.query(`DELETE FROM "Integration" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    for (const org of [A, B]) {
      await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [org]);
      await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [org]);
    }
    await client.query(`DELETE FROM "Organization" WHERE id = ANY($1)`, [[A, B]]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[alice, bob]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

const notificationsOf = (orgId: string, userId: string, type: string) =>
  forOrg(orgId).notification.findMany({ where: { userId, type }, orderBy: { createdAt: "asc" } });

describe("régression PASS → FAIL", () => {
  it("sans responsable du contrôle : le responsable du système est alerté, email une seule fois", async () => {
    await evaluateAs("PASS");
    expect(await notificationsOf(A, bob, "control.failed")).toHaveLength(0);
    await evaluateAs("FAIL");
    const [notification] = await notificationsOf(A, bob, "control.failed");
    expect(notification!.payload).toMatchObject({
      controlKey: "AIA-15-02",
      systemId: systemA,
      reasons: [{ fr: "Raison FAIL", en: "Reason FAIL" }],
    });
    const job = await prisma.job.findFirst({
      where: { dedupeKey: `notification.email:${notification!.id}` },
    });
    expect(job).toMatchObject({ type: "notification.email", orgId: A, status: "QUEUED" });

    const deps = fakeDeps();
    expect(
      await withOrgTransaction(A, (tx) => sendNotificationEmail(tx, A, notification!.id, deps)),
    ).toBe("sent");
    expect(deps.sent).toHaveLength(1);
    expect(deps.sent[0]!.to).toBe(`${bob}@ntf.test`);
    expect(deps.sent[0]!.subject).toBe("[ProofLayer] AIA-15-02 failing · Score");
    expect(deps.sent[0]!.text).toContain(
      `https://app.example.test/systems/${systemA}/controls/${ids.peerA}`,
    );
    // Rejouée (tentative interrompue) : pas de second email.
    expect(
      await withOrgTransaction(A, (tx) => sendNotificationEmail(tx, A, notification!.id, deps)),
    ).toBe("skipped");
    expect(deps.sent).toHaveLength(1);
    // FAIL → FAIL : pas de nouvelle alerte.
    await evaluateAs("FAIL");
    expect(await notificationsOf(A, bob, "control.failed")).toHaveLength(1);
  });

  it("responsable du contrôle prioritaire ; contrôle rétabli avant l'envoi ou préférence coupée : pas d'email", async () => {
    await forOrg(A).controlInstance.update({
      where: { id: ids.peerA! },
      data: { ownerUserId: alice },
    });
    await evaluateAs("PASS");
    await evaluateAs("FAIL");
    const [first] = await notificationsOf(A, alice, "control.failed");
    expect(first).toBeDefined();
    await evaluateAs("PASS"); // rétabli avant que l'email parte
    const deps = fakeDeps();
    expect(await withOrgTransaction(A, (tx) => sendNotificationEmail(tx, A, first!.id, deps))).toBe(
      "skipped",
    );

    await as(alice).notification.preferences.set({
      controlFailedEmail: false,
      dailyDigestEmail: true,
    });
    await evaluateAs("FAIL");
    const all = await notificationsOf(A, alice, "control.failed");
    expect(all).toHaveLength(2);
    expect(
      await withOrgTransaction(A, (tx) => sendNotificationEmail(tx, A, all[1]!.id, deps)),
    ).toBe("skipped");
    expect(deps.sent).toHaveLength(0);
    // L'alerte reste visible dans l'application, et se marque comme lue.
    const listed = await as(alice).notification.list();
    expect(listed.filter((n) => n.type === "control.failed")).toHaveLength(2);
    expect((await as(alice).notification.markRead({ ids: listed.map((n) => n.id) })).count).toBe(2);
    expect((await as(alice).notification.list()).every((n) => n.read)).toBe(true);
    // Les alertes d'un autre ne se marquent pas.
    const bobs = await notificationsOf(A, bob, "control.failed");
    expect((await as(alice).notification.markRead({ ids: bobs.map((n) => n.id) })).count).toBe(0);
    await as(alice).notification.preferences.set({
      controlFailedEmail: true,
      dailyDigestEmail: true,
    });
  });
});

describe("résumé quotidien", () => {
  it("un seul email réunit les organisations ; contenu selon le rôle ; pas deux fois le même jour", async () => {
    const deps = fakeDeps();
    expect(
      await prisma.$transaction((tx) => sendDailyDigest(tx, { userId: alice, day }, deps)),
    ).toBe("sent");
    expect(deps.sent).toHaveLength(1);
    const text = deps.sent[0]!.text;
    // A (owner) : connecteur révoqué, classification à revoir ; B (contributrice) : son attestation qui expire.
    expect(text).toContain("## Org a");
    expect(text).toContain("JIRA : révoqué");
    expect(text).toContain(`/systems/${systemA}/classification`);
    expect(text).toContain("## Org b");
    expect(text).toContain("Revue annuelle Art. 5");
    expect(text).toContain(`/systems/${systemB}/controls/${ids.attestB}`);
    expect(await notificationsOf(A, alice, "digest.daily")).toHaveLength(1);
    expect(await notificationsOf(B, alice, "digest.daily")).toHaveLength(1);

    expect(
      await prisma.$transaction((tx) => sendDailyDigest(tx, { userId: alice, day }, deps)),
    ).toBe("skipped");
    expect(deps.sent).toHaveLength(1);
  });

  it("contributeur responsable d'un système : sa classification à revoir, pas les connecteurs", async () => {
    const deps = fakeDeps();
    expect(await prisma.$transaction((tx) => sendDailyDigest(tx, { userId: bob, day }, deps))).toBe(
      "sent",
    );
    expect(deps.sent[0]!.subject).toBe("[ProofLayer] Daily summary");
    expect(deps.sent[0]!.text).toContain("Score");
    expect(deps.sent[0]!.text).not.toContain("JIRA");
  });

  it("résumé coupé dans toutes ses organisations : aucun email", async () => {
    for (const org of [A, B]) {
      await as(alice, org).notification.preferences.set({
        controlFailedEmail: true,
        dailyDigestEmail: false,
      });
    }
    const deps = fakeDeps();
    expect(
      await prisma.$transaction((tx) =>
        sendDailyDigest(tx, { userId: alice, day: "2099-01-01" }, deps),
      ),
    ).toBe("empty");
    expect(deps.sent).toHaveLength(0);
    expect(await as(alice).notification.preferences.get()).toEqual({
      controlFailedEmail: true,
      dailyDigestEmail: false,
    });
    const entry = await forOrg(A).auditLog.findFirst({
      where: { action: "notification.preferences" },
    });
    expect(entry?.actorId).toBe(alice);
  });

  it("programmation quotidienne : un job par utilisateur et par jour, à 05:47 UTC, dédupliqué", async () => {
    // Un jour futur : les jobs ne sont pas dus et ne partent pas pendant les autres tests.
    const future = new Date("2099-01-02T02:17:00Z");
    await scheduleDailyDigests(future);
    expect((await scheduleDailyDigests(future)).scheduled).toBe(0);
    const jobs = await prisma.job.findMany({
      where: { dedupeKey: { in: [alice, bob].map((u) => `notification.digest:${u}:2099-01-02`) } },
    });
    expect(jobs).toHaveLength(2);
    expect(
      jobs.every((j) => j.orgId === null && j.runAt.toISOString().endsWith("05:47:00.000Z")),
    ).toBe(true);
  });
});
