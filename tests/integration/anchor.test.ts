// PL-502 — Ancrage global sur base réelle : lots de plusieurs organisations sous une même ancre, chaque batchHash
// inclus dans la racine de l'ancre, anchorHash soumis au prestataire, ancres chaînées ; panne du prestataire : rien
// d'écrit, lots conservés pour l'ancre suivante, alerte au-delà de 8 heures ; ancre immuable ; job et programmation.
// Le prestataire est simulé (le client RFC 3161 est testé sur un jeton réel dans tests/unit/tsa.test.ts) ; avec
// TSA_LIVE=1, un dernier test horodate une vraie ancre auprès de freetsa.org et revérifie le jeton.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { anchorHash, type AnchorHeader } from "@/server/seal/anchor";
import { inclusionProof, merkleRoot, verifyInclusion } from "@/server/seal/merkle";
import { TsaError, verifyTimestamp, type TimestampResult } from "@/server/seal/tsa";
import { FREETSA, tsaSetup } from "@/server/seal/tsa-config";
import { sealOrg } from "@/server/services/seal";
import {
  anchorPendingBatches,
  defaultTimestamper,
  pendingBatches,
  type Timestamper,
} from "@/server/system/anchoring";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";
import { anchorDependencies } from "@/server/system/jobs/seal";
import { anchorWindow, scheduleAnchoring } from "@/server/system/seal-schedule";

const run = randomUUID().slice(0, 8);
const orgs = [`org_anc_a_${run}`, `org_anc_b_${run}`];
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
const fixtureToken = new Uint8Array(
  readFileSync(join(process.cwd(), "tests/fixtures/tsa/response.tsr")),
);

/** Prestataire simulé : enregistre l'empreinte reçue, renvoie un jeton (contenu sans importance ici). */
function fakeTsa(fail?: Error): Timestamper & { digests: Buffer[] } {
  const digests: Buffer[] = [];
  return {
    name: "tsa-test",
    digests,
    timestamp: async (digest): Promise<TimestampResult> => {
      digests.push(Buffer.from(digest));
      if (fail) throw fail;
      return { token: fixtureToken, genTime: new Date(), serial: "01", policyOid: "1.2.3" };
    },
  };
}

let counter = 0;
async function sealSome(orgId: string, n: number) {
  const client = direct();
  await client.connect();
  try {
    const start = counter;
    counter += n;
    await client.query(
      `INSERT INTO "EvidenceItem" (id, "orgId", kind, source, "capturedVia", "sourceRef", "dedupeKey", "occurredAt",
         summary, "contentSha256", "leafHash")
       SELECT 'ev_anc_' || $2 || '_' || g, $1, 'github.pull_request.merged', 'GITHUB', 'WEBHOOK', 'r' || g,
         'anc:' || $2 || ':' || g, now(), 'S', sha256(convert_to('c' || g, 'UTF8')),
         sha256(convert_to($2 || ':' || g, 'UTF8'))
       FROM generate_series($3::int, $4::int) g`,
      [orgId, run, start + 1, start + n],
    );
  } finally {
    await client.end();
  }
  return withOrgTransaction(orgId, (tx) => sealOrg(tx, orgId, new Date()));
}

const anchor = (tsa: Timestamper, now = new Date()) =>
  prisma.$transaction((tx) => anchorPendingBatches(tx, now, tsa), { timeout: 30_000 });

/** Lots de nos organisations, lus sous RLS. */
async function ourBatches() {
  const all = [];
  for (const org of orgs) {
    all.push(...(await forOrg(org).sealBatch.findMany({ orderBy: { seq: "asc" } })));
  }
  return all;
}

beforeAll(async () => {
  for (const id of orgs) await prisma.organization.create({ data: { id, name: id, slug: id } });
});

afterAll(async () => {
  anchorDependencies.timestamper = defaultTimestamper;
  const client = direct();
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "dedupeKey" LIKE 'seal.anchor:%'`);
    for (const org of orgs) {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [org]);
      await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "SealBatch" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "Organization" WHERE id = $1`, [org]);
      await client.query("COMMIT");
    }
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("ancrage", () => {
  it("une ancre couvre les lots de toutes les organisations ; chaque lot s'y vérifie ; anchorHash horodaté", async () => {
    await sealSome(orgs[0]!, 4);
    await sealSome(orgs[1]!, 3);
    await sealSome(orgs[0]!, 2);
    const tsa = fakeTsa();
    const outcome = await anchor(tsa);
    expect(outcome).not.toBeNull();
    // Le prestataire n'a reçu que l'anchorHash, 32 octets.
    expect(tsa.digests).toHaveLength(1);
    expect(tsa.digests[0]!.toString("hex")).toBe(outcome!.anchorHash);
    expect(anchorHash(outcome!.header).toString("hex")).toBe(outcome!.anchorHash);

    const row = await prisma.anchor.findUniqueOrThrow({ where: { id: outcome!.id } });
    expect(row).toMatchObject({ seq: outcome!.seq, tsaName: "tsa-test", tsaPolicyOid: "1.2.3" });
    expect(Buffer.from(row.tsaToken).equals(Buffer.from(fixtureToken))).toBe(true);

    // Feuilles de l'ancre : les lots ancrés par ordre d'anchorLeafIndex (lus par la fonction de rattachement).
    const ours = await ourBatches();
    expect(ours.every((b) => b.anchorId === outcome!.id)).toBe(true);
    const client = direct();
    await client.connect();
    try {
      const { rows } = await client.query<{ batchHash: Buffer; anchorLeafIndex: number }>(
        `SELECT "batchHash", "anchorLeafIndex" FROM "SealBatch" WHERE "anchorId" = $1 ORDER BY "anchorLeafIndex"`,
        [outcome!.id],
      );
      expect(rows).toHaveLength(outcome!.batchCount);
      expect(rows.map((r) => r.anchorLeafIndex)).toEqual(rows.map((_, i) => i));
      const leaves = rows.map((r) => r.batchHash);
      expect(merkleRoot(leaves).equals(Buffer.from(row.merkleRoot))).toBe(true);
      for (const b of ours) {
        const i = b.anchorLeafIndex!;
        expect(
          verifyInclusion(b.batchHash, i, leaves.length, inclusionProof(leaves, i), row.merkleRoot),
        ).toBe(true);
      }
    } finally {
      await client.end();
    }
  });

  it("rien en attente : aucune ancre ; ancre suivante chaînée à la précédente", async () => {
    expect(await anchor(fakeTsa())).toBeNull();
    await sealSome(orgs[1]!, 2);
    const previous = await prisma.anchor.findFirstOrThrow({ orderBy: { seq: "desc" } });
    const next = await anchor(fakeTsa());
    expect(next!.seq).toBe(previous.seq + 1);
    const header: AnchorHeader = next!.header;
    expect(header.prevAnchorHash).toBe(Buffer.from(previous.anchorHash).toString("hex"));
  });

  it("panne du prestataire : rien n'est écrit, les lots attendent l'ancre suivante ; alerte au-delà de 8 heures", async () => {
    const before = await prisma.anchor.count();
    const sealed = await sealSome(orgs[0]!, 1);
    const down = fakeTsa(new TsaError("timeout", "délai"));
    const error = await anchor(down).catch((e) => e);
    expect(error).toMatchObject({ code: "timeout", retryable: true });
    expect(await prisma.anchor.count()).toBe(before);
    const pending = await prisma.$transaction((tx) => pendingBatches(tx));
    expect(pending.some((b) => b.id === sealed!.id)).toBe(true);

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const later = new Date(Date.now() + 9 * 3_600_000);
    await anchor(down, later).catch(() => undefined);
    expect(spy.mock.calls.some(([line]) => String(line).includes("seal.anchorOverdue"))).toBe(true);
    // L'alerte ne porte ni empreinte ni donnée client.
    expect(spy.mock.calls.map(([l]) => String(l)).join("\n")).not.toMatch(/[0-9a-f]{64}/u);
    spy.mockRestore();

    // Le prestataire revenu, le lot passe dans l'ancre suivante.
    const recovered = await anchor(fakeTsa());
    expect(recovered).not.toBeNull();
    const [batch] = await forOrg(orgs[0]!).sealBatch.findMany({ where: { id: sealed!.id } });
    expect(batch!.anchorId).toBe(recovered!.id);
  });

  it("ancre immuable, même pour le propriétaire ; un lot ancré ne change pas d'ancre", async () => {
    const latest = await prisma.anchor.findFirstOrThrow({ orderBy: { seq: "desc" } });
    const client = direct();
    await client.connect();
    try {
      await expect(
        client.query(`UPDATE "Anchor" SET "tsaName" = 'x' WHERE id = $1`, [latest.id]),
      ).rejects.toThrow();
      await expect(
        client.query(`DELETE FROM "Anchor" WHERE id = $1`, [latest.id]),
      ).rejects.toThrow();
      await expect(
        client.query(`UPDATE "SealBatch" SET "anchorId" = NULL WHERE "anchorId" = $1`, [latest.id]),
      ).rejects.toThrow();
    } finally {
      await client.end();
    }
    await expect(
      prisma.anchor.update({ where: { id: latest.id }, data: { tsaName: "x" } }),
    ).rejects.toThrow();
  });
});

describe("job et programmation", () => {
  it("un job seal.anchor par fenêtre de 6 heures, dédupliqué ; il ancre avec le prestataire configuré", async () => {
    const tsa = fakeTsa();
    anchorDependencies.timestamper = () => tsa;
    await sealSome(orgs[1]!, 1);
    const now = new Date();
    const first = await scheduleAnchoring(now);
    const second = await scheduleAnchoring(now);
    expect(first).toMatchObject({ window: anchorWindow(now), overdue: false });
    expect(second.scheduled).toBe(false);
    const job = await prisma.job.findFirstOrThrow({
      where: { dedupeKey: `seal.anchor:${anchorWindow(now)}` },
    });
    expect(await runJobNow(job.id, jobRegistry)).toBe("done");
    expect(tsa.digests).toHaveLength(1);
    expect(await prisma.$transaction((tx) => pendingBatches(tx))).toEqual([]);
  });
});

describe.runIf(process.env.TSA_LIVE === "1")("prestataire réel (TSA_LIVE=1)", () => {
  it("freetsa.org horodate l'anchorHash ; le jeton stocké se revérifie hors ligne", async () => {
    anchorDependencies.timestamper = defaultTimestamper;
    await sealSome(orgs[0]!, 1);
    const outcome = await anchor(defaultTimestamper());
    const row = await prisma.anchor.findUniqueOrThrow({ where: { id: outcome!.id } });
    expect(row.tsaName).toBe(FREETSA.name);
    const verified = await verifyTimestamp(row.tsaToken, row.anchorHash, tsaSetup({}).trustAnchors);
    expect(verified.genTime.getTime()).toBe(row.tsaGenTime.getTime());
  }, 30_000);
});
