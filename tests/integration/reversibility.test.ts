// PL-607 — Réversibilité sur base réelle : export complet (registre, preuves déchiffrées, pièces jointes, packs,
// journal ; jamais de jeton) ; suppression programmée par un owner (slug, mot de passe, abonnement résilié), annulable ;
// purge à l'échéance : stockage effacé, toute ligne de l'organisation supprimée (catalogue), clé détruite, trace et
// confirmation par email ; fin de contrat : avis puis purge à 90 jours.
import { mkdtemp, readdir, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { strFromU8, unzipSync } from "fflate";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { generateKey, type MasterKey } from "@/server/crypto/envelope";
import type { EmailMessage } from "@/server/email/transport";
import { createCaller } from "@/server/routers/_app";
import { createEvidence } from "@/server/services/evidence";
import { sendNotificationEmail } from "@/server/services/notifications";
import { cancelDeletion, requestDeletion } from "@/server/services/org-deletion";
import { exportStorage } from "@/server/services/org-export";
import { packObjectKey } from "@/server/services/packs";
import { LocalObjectStore } from "@/server/storage/object-store";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { pruneStorage } from "@/server/system/jobs/maintenance";
import { orgDeletionDependencies } from "@/server/system/jobs/org-deletion";
import { runJobNow } from "@/server/system/jobs/queue";
import { contractEndPurgeAt, dueDeletions } from "@/server/system/org-deletion";
import { scheduleOrgDeletions } from "@/server/system/org-deletion-schedule";

const run = randomUUID().slice(0, 8);
const A = `org_rev_a_${run}`;
const B = `org_rev_b_${run}`;
const owner = `usr_rev_owner_${run}`;
const admin = `usr_rev_admin_${run}`;
const master: MasterKey = { id: "test", key: generateKey() };
const sent: EmailMessage[] = [];
const transport = { send: async (m: EmailMessage) => void sent.push(m) };
let dir = "";
let store: LocalObjectStore;
let clock = new Date();
let t0 = clock;
const DAY = 86_400_000;
let packId = "";
let evidenceId = "";

const as = (userId: string, orgId = A) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: orgId } });
const ctx = (orgId = A) => ({
  headers: new Headers(),
  userId: owner,
  orgId,
  role: "owner" as const,
  db: forOrg(orgId),
});
const deps = (ok = true) => ({
  verifyPassword: async () => ok,
  notify: async () => undefined,
  now: () => clock,
});

async function runJob(dedupeKey: string) {
  const job = await prisma.job.findFirstOrThrow({ where: { dedupeKey } });
  return runJobNow(job.id, jobRegistry);
}

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pl-rev-"));
  store = new LocalObjectStore(dir);
  exportStorage.get = () => ({ store, master: () => master, now: () => clock });
  orgDeletionDependencies.get = () => ({
    store,
    transport,
    baseUrl: "https://app.example.test",
    now: () => clock,
  });
  for (const [id, name] of [
    [owner, "Clara"],
    [admin, "Hugo"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@rev.test`, name } });
  }
  for (const org of [A, B]) {
    await prisma.organization.create({ data: { id: org, name: `Talvio ${org}`, slug: org } });
    await prisma.member.create({
      data: { id: `mem_${org}_o`, organizationId: org, userId: owner, role: "owner" },
    });
  }
  await prisma.member.create({
    data: { id: `mem_${A}_a`, organizationId: A, userId: admin, role: "admin" },
  });
  const system = await forOrg(A).aiSystem.create({
    data: {
      orgId: A,
      name: "Score",
      slug: `score-${run}`,
      intendedPurpose: "Tri",
      ownerUserId: owner,
      models: [],
      monitored: true,
    },
  });
  await forOrg(A).integration.create({
    data: {
      orgId: A,
      provider: "JIRA",
      externalAccountId: `cloud-${run}`,
      externalAccountName: "talvio",
      credentialsCiphertext: Buffer.from("SECRET-TOKEN-CIPHERTEXT"),
      createdByUserId: owner,
    },
  });
  evidenceId = (
    await withOrgTransaction(A, (tx) =>
      createEvidence(
        tx,
        A,
        {
          kind: "manual.document",
          source: "MANUAL",
          capturedVia: "UPLOAD",
          sourceRef: `doc:${run}`,
          dedupeKey: `doc:${run}`,
          occurredAt: new Date("2026-11-01T00:00:00Z"),
          summary: "Politique de gestion des risques",
          payload: { title: "Politique" },
          raw: { original: "charge brute" },
          attachment: { data: Buffer.from("%PDF-1.7 contenu"), mime: "application/pdf" },
        },
        { store, master, now: () => clock },
      ),
    )
  ).id;
  const pack = await forOrg(A).auditPack.create({
    data: {
      orgId: A,
      systemId: system.id,
      requestedByUserId: owner,
      periodStart: new Date("2026-10-01T00:00:00Z"),
      periodEnd: new Date("2026-10-31T00:00:00Z"),
      status: "READY",
    },
  });
  packId = pack.id;
  await forOrg(A).auditPack.update({
    where: { id: pack.id },
    data: { objectKey: packObjectKey(A, pack.id) },
  });
  await store.put(packObjectKey(A, pack.id), Buffer.from("PK-pack"));
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "dedupeKey" LIKE ANY($1)`, [[`%${run}%`, "org.%"]]);
    await client.query(`DELETE FROM "OrganizationDeletion" WHERE "orgId" = ANY($1)`, [[A, B]]);
    for (const org of [A, B]) await client.query("SELECT purge_organization($1)", [org]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[owner, admin]]);
  } finally {
    await client.end();
  }
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("export complet", () => {
  let exportId = "";

  it("owner : programmé ; un second export attend la fin du premier ; admin refusé", async () => {
    exportId = (await as(owner).org.export.request()).id;
    await expect(as(owner).org.export.request()).rejects.toThrow("export.inProgress");
    await expect(as(admin).org.export.list()).rejects.toThrow();
  });

  it("archive : registre, preuve déchiffrée, pièce jointe, pack, journal ; aucun jeton", async () => {
    await runJob(`org.export:${exportId}`);
    const [row] = await as(owner).org.export.list();
    expect(row).toMatchObject({ id: exportId, status: "READY" });
    const { bytes, filename } = await as(owner).org.export.download({ exportId });
    expect(filename).toMatch(/^prooflayer-export-\d{4}-\d{2}-\d{2}\.zip$/u);
    // Revue finale : au repos, l'archive est chiffrée par la clé de l'organisation (pas une archive ZIP lisible).
    const atRest = await store.get(`orgs/${A}/exports/${exportId}.zip`);
    expect(atRest![0]).toBe(0x01);
    expect(atRest!.subarray(0, 2).toString()).not.toBe("PK");
    const files = unzipSync(new Uint8Array(bytes));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest).toMatchObject({
      format: "prooflayer-org-export",
      organization: { id: A, slug: A },
      counts: { systems: 1, evidence: 1, attachments: 1, packs: 1 },
    });
    expect(Object.keys(manifest.files).sort()).toEqual(
      Object.keys(files)
        .filter((p) => p !== "manifest.json")
        .sort(),
    );
    const evidence = JSON.parse(strFromU8(files[`evidence/${evidenceId}.json`]!));
    expect(evidence).toMatchObject({ id: evidenceId, payload: { title: "Politique" } });
    expect(evidence).not.toHaveProperty("rawObjectKey");
    expect(JSON.parse(strFromU8(files[`evidence/${evidenceId}.raw.json`]!))).toEqual({
      original: "charge brute",
    });
    expect(strFromU8(files[`evidence/${evidenceId}.pdf`]!)).toBe("%PDF-1.7 contenu");
    expect(strFromU8(files[`packs/${packId}.zip`]!)).toBe("PK-pack");
    const integrations = strFromU8(files["organization/integrations.json"]!);
    expect(integrations).toContain("talvio");
    expect(integrations).not.toContain("credentials");
    const audit = JSON.parse(strFromU8(files["audit-log.json"]!)) as { action: string }[];
    expect(audit.some((a) => a.action === "org.export")).toBe(true);
  });

  it("le demandeur est prévenu par email", async () => {
    const [notification] = await forOrg(A).notification.findMany({
      where: { type: "export.ready" },
    });
    expect(notification?.userId).toBe(owner);
    const mails: EmailMessage[] = [];
    await withOrgTransaction(A, (tx) =>
      sendNotificationEmail(tx, A, notification!.id, {
        transport: { send: async (m: EmailMessage) => void mails.push(m) },
        baseUrl: "https://app.example.test",
        now: () => new Date(),
      } as never),
    );
    expect(mails[0]?.subject).toBe(`[ProofLayer] Export prêt · Talvio ${A}`);
    expect(mails[0]?.text).toContain("https://app.example.test/organization/data");
  });
});

describe("ménage du stockage (revue finale)", () => {
  it("export expiré à 7 jours : archive supprimée ; dépôt abandonné effacé à 24 heures", async () => {
    const [exported] = await as(owner).org.export.list();
    await forOrg(A).orgExport.update({
      where: { id: exported!.id },
      data: { completedAt: new Date(Date.now() - 8 * 86_400_000) },
    });
    await store.put(`orgs/${A}/incoming/ancien`, Buffer.from("en clair"));
    await store.put(`orgs/${A}/incoming/recent`, Buffer.from("en clair"));
    const old = new Date(Date.now() - 25 * 3_600_000);
    await utimes(join(dir, "orgs", A, "incoming", "ancien"), old, old);

    const result = await pruneStorage(new Date(), store);
    expect(result.exports).toBeGreaterThanOrEqual(1);
    expect(result.uploads).toBeGreaterThanOrEqual(1);
    expect(await store.get(`orgs/${A}/exports/${exported!.id}.zip`)).toBeNull();
    expect((await as(owner).org.export.list())[0]).toMatchObject({ status: "EXPIRED" });
    await expect(as(owner).org.export.download({ exportId: exported!.id })).rejects.toThrow(
      "export.notReady",
    );
    expect(await store.size(`orgs/${A}/incoming/ancien`)).toBeNull();
    expect(await store.size(`orgs/${A}/incoming/recent`)).toBe(8);
  });
});

describe("suppression demandée par un owner", () => {
  it("slug erroné, mot de passe faux, abonnement payant actif : refusée", async () => {
    // Heure réelle : la base refuse au rôle applicatif une échéance à moins de 6 jours (revue finale).
    clock = new Date(Math.floor(Date.now() / 1000) * 1000);
    t0 = clock;
    await expect(
      requestDeletion(ctx(), { password: "x", confirmation: "autre" }, deps()),
    ).rejects.toThrow("deletion.confirmationMismatch");
    await expect(
      requestDeletion(ctx(), { password: "x", confirmation: A }, deps(false)),
    ).rejects.toThrow("classification.invalidPassword");
    expect(await forOrg(A).auditLog.count({ where: { action: "org.deletionRefused" } })).toBe(1);
    await forOrg(A).subscription.create({
      data: {
        orgId: A,
        plan: "GROWTH",
        status: "active",
        stripeSubscriptionId: `sub_${run}`,
        monitoredSystemsLimit: 5,
      },
    });
    await expect(
      requestDeletion(ctx(), { password: "x", confirmation: A }, deps()),
    ).rejects.toThrow("deletion.activeSubscription");
    await forOrg(A).subscription.update({ where: { orgId: A }, data: { cancelAtPeriodEnd: true } });
  });

  it("programmée à 7 jours, avis aux owners, annulable", async () => {
    const scheduled = await requestDeletion(ctx(), { password: "x", confirmation: A }, deps());
    expect(scheduled?.scheduledFor).toBe(new Date(t0.getTime() + 7 * DAY).toISOString());
    await expect(
      requestDeletion(ctx(), { password: "x", confirmation: A }, deps()),
    ).rejects.toThrow("deletion.alreadyScheduled");
    expect(await as(owner).org.deletion.get()).toMatchObject({ reason: "owner_request" });
    await cancelDeletion(ctx(), clock);
    expect(await as(owner).org.deletion.get()).toBeNull();
  });

  it("à l'échéance : stockage effacé, aucune ligne de l'organisation, trace et confirmation", async () => {
    await requestDeletion(ctx(), { password: "x", confirmation: A }, deps());
    const { id } = await prisma.organizationDeletion.findFirstOrThrow({
      where: { orgId: A, cancelledAt: null, completedAt: null },
    });
    const notice = sent.length;
    const { orgDeletionNoticeJob } = await import("@/server/system/jobs/org-deletion");
    const { enqueue } = await import("@/server/system/jobs/queue");
    await enqueue(orgDeletionNoticeJob, { deletionId: id }, { dedupeKey: `org.notice:${run}` });
    await runJob(`org.notice:${run}`);
    expect(sent.slice(notice).map((m) => m.subject)).toEqual([
      `[ProofLayer] Suppression programmée · Talvio ${A}`,
    ]);

    // Pas encore échue : rien n'est programmé.
    expect((await dueDeletions(new Date(t0.getTime() + 5 * DAY))).due).not.toContain(id);
    // Revue finale : avant l'échéance, le rôle applicatif ne peut ni purger ni avancer l'échéance.
    await expect(prisma.$queryRaw`SELECT purge_organization(${A})`).rejects.toThrow();
    await expect(
      prisma.organizationDeletion.update({ where: { id }, data: { scheduledFor: new Date() } }),
    ).rejects.toThrow();
    await expect(
      prisma.organizationDeletion.create({
        data: { orgId: B, reason: "owner_request", scheduledFor: new Date(Date.now() + DAY) },
      }),
    ).rejects.toThrow();
    expect(await prisma.organization.count({ where: { id: A } })).toBe(1);
    // Le temps passe : l'échéance est reculée sous le rôle d'administration, seul à pouvoir la modifier.
    const admin = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(
        `UPDATE "OrganizationDeletion" SET "scheduledFor" = now() - interval '1 minute' WHERE id = $1`,
        [id],
      );
    } finally {
      await admin.end();
    }
    clock = new Date();
    await scheduleOrgDeletions(clock);
    await runJob(`org.purge:${id}`);

    expect(await readdir(join(dir, "orgs", A)).catch(() => null)).toBeNull();
    const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
    await client.connect();
    try {
      const { rows: tables } = await client.query<{ table_name: string }>(
        `SELECT table_name FROM information_schema.columns
          WHERE table_schema = 'public' AND column_name = 'orgId'
            AND table_name NOT IN ('OrganizationDeletion')`,
      );
      for (const { table_name } of tables) {
        const { rows } = await client.query(
          `SELECT count(*)::int AS n FROM "${table_name}" WHERE "orgId" = $1`,
          [A],
        );
        expect(rows[0].n, table_name).toBe(0);
      }
      const org = await client.query(`SELECT 1 FROM "Organization" WHERE id = $1`, [A]);
      expect(org.rowCount).toBe(0);
      const member = await client.query(`SELECT 1 FROM "Member" WHERE "organizationId" = $1`, [A]);
      expect(member.rowCount).toBe(0);
      // L'autre organisation est intacte.
      expect((await client.query(`SELECT 1 FROM "Organization" WHERE id = $1`, [B])).rowCount).toBe(
        1,
      );
    } finally {
      await client.end();
    }
    const trace = await prisma.organizationDeletion.findUniqueOrThrow({ where: { id } });
    expect(trace).toMatchObject({ reason: "owner_request", notifyEmails: null });
    expect(trace.completedAt).not.toBeNull();
    expect(trace.confirmedAt).not.toBeNull();
    expect(sent.at(-1)?.subject).toBe(`[ProofLayer] Organisation supprimée · Talvio ${A}`);
    // Rejouer le job ne fait rien.
    const before = sent.length;
    await prisma.job.updateMany({
      where: { dedupeKey: `org.purge:${id}` },
      data: { status: "QUEUED", runAt: new Date() },
    });
    await runJob(`org.purge:${id}`);
    expect(sent.length).toBe(before);
  });
});

describe("fin de contrat", () => {
  it("abonnement terminé : avis à J-7, purge à 90 jours après la fin", async () => {
    // Fin d'abonnement telle que la purge tombe dans 7 jours et une heure (heure réelle, voir plus haut).
    const end = new Date(Math.floor(Date.now() / 1000) * 1000 - 83 * DAY + 3_600_000);
    await forOrg(B).subscription.create({
      data: {
        orgId: B,
        plan: "GROWTH",
        status: "canceled",
        currentPeriodEnd: end,
        monitoredSystemsLimit: 5,
      },
    });
    const purgeAt = new Date(end.getTime() + 90 * 86_400_000);
    expect((await dueDeletions(new Date(purgeAt.getTime() - 8 * 86_400_000))).noticed).toBe(0);
    const notice = await dueDeletions(new Date(purgeAt.getTime() - 7 * 86_400_000));
    expect(notice.noticed).toBe(1);
    const row = await prisma.organizationDeletion.findFirstOrThrow({
      where: { orgId: B, completedAt: null, cancelledAt: null },
    });
    expect(row).toMatchObject({ reason: "contract_end", scheduledFor: purgeAt });
    // Un second passage ne crée pas de doublon.
    expect((await dueDeletions(new Date(purgeAt.getTime() - 6 * 86_400_000))).noticed).toBe(0);
  });

  it("annulée par un owner : pas reprogrammée avant 30 jours (ni nouvel email), puis de nouveau", async () => {
    const cancelAt = new Date();
    await cancelDeletion(ctx(B), cancelAt);
    const pendingFor = () =>
      prisma.organizationDeletion.count({
        where: { orgId: B, cancelledAt: null, completedAt: null },
      });
    await dueDeletions(new Date(cancelAt.getTime() + 86_400_000));
    await dueDeletions(new Date(cancelAt.getTime() + 29 * 86_400_000));
    expect(await pendingFor()).toBe(0);
    await dueDeletions(new Date(cancelAt.getTime() + 31 * 86_400_000));
    expect(await pendingFor()).toBe(1);
  });

  it("essai expiré jamais converti : jamais purgé d'office", () => {
    const now = new Date("2027-06-01T00:00:00Z");
    expect(
      contractEndPurgeAt(
        {
          plan: "TRIAL",
          status: "trialing",
          trialEndsAt: new Date("2026-11-01T00:00:00Z"),
          currentPeriodEnd: null,
        },
        now,
      ),
    ).toBeNull();
    expect(
      contractEndPurgeAt(
        {
          plan: "STARTER",
          status: "canceled",
          trialEndsAt: null,
          currentPeriodEnd: new Date("2026-11-01T00:00:00Z"),
        },
        now,
      ),
    ).toEqual(new Date("2027-01-30T00:00:00Z"));
  });
});
