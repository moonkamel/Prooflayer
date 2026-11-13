// PL-501 — Scellement par lots sur base réelle : tri, racine, chaînage et rattachement des preuves écrits ensemble ;
// chaque feuille se vérifie contre la racine du lot ; `seq` continu sous scellements concurrents (verrou consultatif) ;
// lots bornés ; job horaire dédupliqué ; lots et positions immuables en base.
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { batchHash, chainBreak, type BatchHeader } from "@/server/seal/batch";
import { inclusionProof, merkleRoot, verifyInclusion } from "@/server/seal/merkle";
import { sealOrg } from "@/server/services/seal";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";
import { scheduleHourlySealing, sealHour } from "@/server/system/seal-schedule";

const run = randomUUID().slice(0, 8);
const A = `org_seal_${run}`;
let counter = 0;
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });

/** Insère n preuves non scellées (feuilles réelles de 32 octets, dates de capture étalées). */
async function addEvidence(n: number) {
  const client = direct();
  await client.connect();
  try {
    const start = counter;
    counter += n;
    await client.query(
      `INSERT INTO "EvidenceItem" (id, "orgId", kind, source, "capturedVia", "sourceRef", "dedupeKey", "occurredAt",
         "capturedAt", summary, "contentSha256", "leafHash")
       SELECT 'ev_seal_' || $2 || '_' || g, $1, 'github.pull_request.merged', 'GITHUB', 'WEBHOOK', 'r' || g,
         'seal:' || $2 || ':' || g, now(), now() - make_interval(secs => (g % 7)), 'S',
         sha256(convert_to('c' || g, 'UTF8')), sha256(convert_to($2 || ':leaf:' || g, 'UTF8'))
       FROM generate_series($3::int, $4::int) g`,
      [A, run, start + 1, start + n],
    );
  } finally {
    await client.end();
  }
}

const seal = (maxLeaves?: number) =>
  withOrgTransaction(A, (tx) => sealOrg(tx, A, new Date(), maxLeaves));

async function batches() {
  return forOrg(A).sealBatch.findMany({ orderBy: { seq: "asc" } });
}

const headerOf = (b: Awaited<ReturnType<typeof batches>>[number]): BatchHeader => ({
  v: 1,
  org: b.orgId,
  seq: b.seq,
  leafCount: b.leafCount,
  merkleRoot: Buffer.from(b.merkleRoot).toString("hex"),
  prevBatchHash: Buffer.from(b.prevBatchHash).toString("hex"),
  sealedAt: b.sealedAt.toISOString(),
});

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
});

afterAll(async () => {
  const client = direct();
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "SealBatch" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("scellement d'un lot", () => {
  it("rien à sceller : aucun lot", async () => {
    expect(await seal()).toBeNull();
  });

  it("premier lot : tri, racine, en-tête et rattachement ; chaque feuille se vérifie", async () => {
    await addEvidence(37);
    const sealed = await seal();
    expect(sealed).toMatchObject({ seq: 1, leafCount: 37 });
    const [batch] = await batches();
    expect(Buffer.from(batch!.prevBatchHash).equals(Buffer.alloc(32))).toBe(true);
    expect(batchHash(headerOf(batch!)).equals(Buffer.from(batch!.batchHash))).toBe(true);

    const items = await forOrg(A).evidenceItem.findMany({
      where: { sealBatchId: batch!.id },
      orderBy: { leafIndex: "asc" },
    });
    expect(items.map((i) => i.leafIndex)).toEqual(Array.from({ length: 37 }, (_, i) => i));
    // Ordre du §4.6.2 : capturedAt, puis identifiant.
    const order = [...items].sort(
      (a, b) => a.capturedAt.getTime() - b.capturedAt.getTime() || (a.id < b.id ? -1 : 1),
    );
    expect(items.map((i) => i.id)).toEqual(order.map((i) => i.id));
    const leaves = items.map((i) => Buffer.from(i.leafHash));
    expect(merkleRoot(leaves).equals(Buffer.from(batch!.merkleRoot))).toBe(true);
    for (const [i, leaf] of leaves.entries()) {
      expect(verifyInclusion(leaf, i, 37, inclusionProof(leaves, i), batch!.merkleRoot)).toBe(true);
    }
  });

  it("lot suivant chaîné au précédent ; lots bornés", async () => {
    await addEvidence(25);
    expect(await seal(10)).toMatchObject({ seq: 2, leafCount: 10 });
    expect(await seal(10)).toMatchObject({ seq: 3, leafCount: 10 });
    expect(await seal()).toMatchObject({ seq: 4, leafCount: 5 });
    const all = await batches();
    expect(chainBreak(all.map(headerOf))).toBeNull();
    expect(Buffer.from(all[1]!.prevBatchHash).equals(Buffer.from(all[0]!.batchHash))).toBe(true);
  });

  it("scellements concurrents pendant l'arrivée de preuves : seq continu, chaque preuve dans un seul lot", async () => {
    await addEvidence(60);
    const results = await Promise.all([
      seal(15),
      seal(15),
      addEvidence(20).then(() => seal(15)),
      seal(15),
      seal(15),
      seal(15),
    ]);
    while (await seal()) {
      // vide ce qui reste
    }
    const all = await batches();
    expect(all.map((b) => b.seq)).toEqual(Array.from({ length: all.length }, (_, i) => i + 1));
    expect(chainBreak(all.map(headerOf))).toBeNull();
    expect(results.filter(Boolean).length).toBeGreaterThan(1);
    const pending = await forOrg(A).evidenceItem.count({ where: { sealBatchId: null } });
    expect(pending).toBe(0);
    const total = await forOrg(A).evidenceItem.count();
    expect(all.reduce((n, b) => n + b.leafCount, 0)).toBe(total);
    for (const b of all) {
      const items = await forOrg(A).evidenceItem.findMany({
        where: { sealBatchId: b.id },
        orderBy: { leafIndex: "asc" },
        select: { leafHash: true },
      });
      expect(
        merkleRoot(items.map((i) => Buffer.from(i.leafHash))).equals(Buffer.from(b.merkleRoot)),
      ).toBe(true);
    }
  });
});

describe("job horaire", () => {
  it("un job seal.org par organisation et par heure, dédupliqué ; il scelle les preuves en attente", async () => {
    await addEvidence(3);
    const now = new Date();
    await scheduleHourlySealing(now);
    await scheduleHourlySealing(now);
    const jobs = await prisma.job.findMany({
      where: { dedupeKey: `seal.org:${A}:${sealHour(now)}` },
    });
    expect(jobs).toHaveLength(1);
    expect(await runJobNow(jobs[0]!.id, jobRegistry)).toBe("done");
    expect(await forOrg(A).evidenceItem.count({ where: { sealBatchId: null } })).toBe(0);
  });
});

describe("immuabilité en base", () => {
  it("ni le lot, ni la position d'une feuille scellée ne changent ; un lot ne se supprime pas", async () => {
    const client = direct();
    await client.connect();
    try {
      const [batch] = await batches();
      const reject = (sql: string, params: unknown[]) =>
        expect(client.query(sql, params)).rejects.toThrow();
      await reject(`UPDATE "SealBatch" SET "merkleRoot" = $2 WHERE id = $1`, [
        batch!.id,
        createHash("sha256").update("x").digest(),
      ]);
      await reject(`UPDATE "SealBatch" SET seq = 99 WHERE id = $1`, [batch!.id]);
      await reject(`DELETE FROM "SealBatch" WHERE id = $1`, [batch!.id]);
      await reject(
        `UPDATE "EvidenceItem" SET "leafIndex" = 99 WHERE "sealBatchId" = $1 AND "leafIndex" = 0`,
        [batch!.id],
      );
      await reject(`UPDATE "EvidenceItem" SET "sealBatchId" = NULL WHERE "sealBatchId" = $1`, [
        batch!.id,
      ]);
    } finally {
      await client.end();
    }
    // Une preuve ne se scelle pas sans sa position.
    await addEvidence(1);
    const [pending] = await forOrg(A).evidenceItem.findMany({ where: { sealBatchId: null } });
    const [batch] = await batches();
    await expect(
      withOrgTransaction(A, (tx) =>
        tx.evidenceItem.update({ where: { id: pending!.id }, data: { sealBatchId: batch!.id } }),
      ),
    ).rejects.toThrow();
  });
});
