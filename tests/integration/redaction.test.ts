// PL-507 — Effacement compatible avec le scellement, sur base réelle : `evidence.redact` (admin) met à NULL charge,
// acteur et sel, supprime la charge brute et la pièce jointe du stockage, journalise sans contenu ; le lot, l'ancre et
// les autres preuves se vérifient toujours (revérification de l'organisation, preuve d'inclusion de chaque feuille) ;
// effacement définitif (deuxième effacement refusé) ; le déclencheur refuse tout autre usage des champs effaçables.
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey, type MasterKey } from "@/server/crypto/envelope";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { createCaller } from "@/server/routers/_app";
import { verifyProof } from "@/server/seal/chain";
import { verifyOrgChain } from "@/server/services/chain-verification";
import { createEvidence } from "@/server/services/evidence";
import { redactionStorage } from "@/server/services/evidence-redaction";
import { sealOrg } from "@/server/services/seal";
import { anchorPendingBatches, type Timestamper } from "@/server/system/anchoring";
import { LocalObjectStore } from "@/server/storage/object-store";
import { createTestTsa, TEST_POLICY_OID, type TestTsa } from "../helpers/test-tsa";

const run = randomUUID().slice(0, 8);
const A = `org_redact_${run}`;
const admin = `usr_redact_admin_${run}`;
const contributor = `usr_redact_contrib_${run}`;
const master: MasterKey = { id: "test", key: generateKey() };
const ids: string[] = [];
let dir = "";
let store: LocalObjectStore;
let tsa: TestTsa;
const as = (userId: string) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: A } });
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pl-redact-"));
  store = new LocalObjectStore(dir, "secret-redact-0123456789");
  redactionStorage.store = () => store;
  tsa = await createTestTsa();
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  for (const [id, role] of [
    [admin, "admin"],
    [contributor, "contributor"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@redact.test`, name: role } });
    await prisma.member.create({ data: { id: `mem_${id}`, organizationId: A, userId: id, role } });
  }
  await withOrgTransaction(A, async (tx) => {
    for (let i = 0; i < 4; i++) {
      const created = await createEvidence(
        tx,
        A,
        {
          kind: i === 3 ? "manual.upload" : "github.pull_request.merged",
          source: i === 3 ? "MANUAL" : "GITHUB",
          capturedVia: i === 3 ? "UPLOAD" : "WEBHOOK",
          sourceRef: `redact:${run}:${i}`,
          dedupeKey: `redact:${run}:${i}`,
          occurredAt: new Date(),
          summary: `PR #${i}`,
          actor: { login: `personne-${i}` },
          payload: { number: i, author: `personne-${i}` },
          raw: { body: `contenu brut ${i}` },
          ...(i === 3
            ? {
                attachment: { data: Buffer.from("%PDF-1.7 CV de Jeanne"), mime: "application/pdf" },
              }
            : {}),
        },
        { store, master },
      );
      ids.push(created.id);
    }
  });
  await withOrgTransaction(A, (tx) => sealOrg(tx, A, new Date()));
  const timestamper: Timestamper = {
    name: "Prestataire de test",
    timestamp: async (digest) => {
      const genTime = new Date();
      return {
        token: await tsa.token(digest, genTime),
        genTime,
        serial: "1",
        policyOid: TEST_POLICY_OID,
      };
    },
  };
  await prisma.$transaction((tx) => anchorPendingBatches(tx, new Date(), timestamper), {
    timeout: 30_000,
  });
});

afterAll(async () => {
  const client = direct();
  await client.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "SealBatch" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[admin, contributor]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("evidence.redact", () => {
  it("contributeur : refusé ; rien n'est effacé", async () => {
    await expect(
      as(contributor).evidence.redact({ evidenceId: ids[1]!, reason: "data_subject_request" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    const row = await forOrg(A).evidenceItem.findUniqueOrThrow({ where: { id: ids[1]! } });
    expect(row.redactedAt).toBeNull();
  });

  it("charge, acteur et sel à NULL, charge brute et pièce jointe supprimées, journal sans contenu", async () => {
    const before = await forOrg(A).evidenceItem.findMany({
      where: { id: { in: [ids[1]!, ids[3]!] } },
      orderBy: { sourceRef: "asc" },
    });
    expect(before.every((e) => e.rawObjectKey)).toBe(true);
    expect(before[1]!.attachmentKey).not.toBeNull();
    for (const id of [ids[1]!, ids[3]!]) {
      const result = await as(admin).evidence.redact({
        evidenceId: id,
        reason: "data_subject_request",
      });
      expect(result.evidenceId).toBe(id);
    }
    const after = await forOrg(A).evidenceItem.findMany({
      where: { id: { in: [ids[1]!, ids[3]!] } },
      orderBy: { sourceRef: "asc" },
    });
    for (const [i, e] of after.entries()) {
      expect(e).toMatchObject({
        payload: null,
        actor: null,
        salt: null,
        rawObjectKey: null,
        attachmentKey: null,
      });
      expect(e.redactedAt).not.toBeNull();
      // La feuille et l'enveloppe scellée demeurent.
      expect(Buffer.from(e.leafHash).equals(Buffer.from(before[i]!.leafHash))).toBe(true);
      expect(e.sealBatchId).toBe(before[i]!.sealBatchId);
    }
    expect(await store.get(before[0]!.rawObjectKey!)).toBeNull();
    expect(await store.get(before[1]!.attachmentKey!)).toBeNull();
    // Les autres preuves gardent leur charge brute.
    const other = await forOrg(A).evidenceItem.findUniqueOrThrow({ where: { id: ids[0]! } });
    expect(await store.get(other.rawObjectKey!)).not.toBeNull();
    const logs = await forOrg(A).auditLog.findMany({ where: { action: "evidence.redact" } });
    expect(logs).toHaveLength(2);
    expect(logs[0]!.metadata).toEqual(
      expect.objectContaining({ reason: "data_subject_request", rawDeleted: true }),
    );
    expect(JSON.stringify(logs)).not.toMatch(/personne-|contenu brut|Jeanne/u);
  });

  it("effacement définitif : un second effacement est refusé ; preuve inconnue : introuvable", async () => {
    await expect(
      as(admin).evidence.redact({ evidenceId: ids[1]!, reason: "other" }),
    ).rejects.toThrow("evidence.alreadyRedacted");
    await expect(
      as(admin).evidence.redact({ evidenceId: "ev_inconnue", reason: "other" }),
    ).rejects.toThrow("evidence.notFound");
  });

  it("le lot, l'ancre et les autres preuves se vérifient toujours", async () => {
    const report = await withOrgTransaction(A, (tx) => verifyOrgChain(tx, A));
    expect(report).toMatchObject({ leaves: 4, issues: [] });
    for (const id of ids) {
      const result = await as(admin).evidence.proof({ evidenceId: id });
      if (!result.sealed) throw new Error("scellée attendue");
      expect(result.anchored).toBe(true);
      expect(verifyProof(result.proof)).toEqual({ ok: true });
    }
  });
});

describe("déclencheur evidence_guard", () => {
  async function reject(sql: string, params: unknown[], message: string) {
    const client = direct();
    await client.connect();
    try {
      await expect(client.query(sql, params)).rejects.toThrow(message);
    } finally {
      await client.end();
    }
  }

  it("une preuve effacée ne retrouve ni sel, ni charge, ni date d'effacement différente", async () => {
    await reject(
      `UPDATE "EvidenceItem" SET salt = '\\x00' WHERE id = $1`,
      [ids[1]],
      "ne peuvent qu'être mis à NULL",
    );
    await reject(
      `UPDATE "EvidenceItem" SET "redactedAt" = NULL WHERE id = $1`,
      [ids[1]],
      "preuve déjà effacée",
    );
  });

  it("le sel ne disparaît qu'avec l'effacement, et l'effacement emporte charge brute et fichiers", async () => {
    await reject(
      `UPDATE "EvidenceItem" SET salt = NULL WHERE id = $1`,
      [ids[0]],
      "le sel ne disparaît qu'avec l'effacement",
    );
    await reject(
      `UPDATE "EvidenceItem" SET payload = NULL, actor = NULL, salt = NULL, "redactedAt" = now() WHERE id = $1`,
      [ids[0]],
      "charge, acteur, sel et fichiers à NULL",
    );
  });
});
