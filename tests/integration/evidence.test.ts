// PL-304 — Magasin de preuves sur base réelle (rôle applicatif, RLS) : empreintes du §4.6.2, doublon ignoré sans
// erreur, charge brute chiffrée par organisation en stockage objet, trigger d'immutabilité du §4.3.3.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { decrypt, generateKey, unwrapKey, type MasterKey } from "@/server/crypto/envelope";
import { contentSha256, envelopeOf, evidenceLeafHash } from "@/server/seal/evidence";
import { createEvidence, rawObjectKey, type EvidenceInput } from "@/server/services/evidence";
import { LocalObjectStore } from "@/server/storage/object-store";

const run = randomUUID().slice(0, 8);
const A = `org_evd_a_${run}`;
const B = `org_evd_b_${run}`;
const master: MasterKey = { id: "test", key: generateKey() };
let dir: string;
let store: LocalObjectStore;
const now = new Date("2026-11-12T10:00:00.000Z");

const input = (n: number): EvidenceInput => ({
  kind: "github.pull_request.merged",
  source: "GITHUB",
  capturedVia: "WEBHOOK",
  sourceRef: `gh:pr:123:${n}`,
  sourceUrl: `https://github.com/acme/scoring/pull/${n}`,
  dedupeKey: `gh:pr:123:${n}:merged`,
  occurredAt: new Date("2026-11-10T09:00:00.000Z"),
  summary: `PR #${n} fusionnée`,
  actor: { login: "clara" },
  payload: { number: n, mergedAt: "2026-11-10T09:00:00Z", approvals: 1, base: "main" },
  raw: { action: "closed", pull_request: { number: n, body: "contenu brut, jamais en base" } },
});

const create = (org: string, data: EvidenceInput) =>
  withOrgTransaction(org, (tx) => createEvidence(tx, org, data, { store, master, now: () => now }));

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "pl-objects-"));
  store = new LocalObjectStore(dir);
  for (const org of [A, B])
    await prisma.organization.create({ data: { id: org, name: org, slug: org } });
});

afterAll(async () => {
  const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
  await client.connect();
  try {
    for (const org of [A, B]) {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [org]);
      await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "OrgEncryptionKey" WHERE "orgId" = $1`, [org]);
      await client.query(`DELETE FROM "Organization" WHERE "id" = $1`, [org]);
      await client.query("COMMIT");
    }
  } finally {
    await client.end();
  }
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

describe("createEvidence", () => {
  it("calcule contentSha256, sel et leafHash du §4.6.2 ; la feuille se recalcule depuis la base", async () => {
    const result = await create(A, input(1));
    expect(result.created).toBe(true);
    const row = await forOrg(A).evidenceItem.findUniqueOrThrow({ where: { id: result.id } });
    expect(Buffer.from(row.contentSha256).equals(contentSha256(input(1).payload))).toBe(true);
    expect(row.salt).toHaveLength(32);
    const envelope = envelopeOf({
      orgId: A,
      id: row.id,
      kind: row.kind,
      sourceRef: row.sourceRef,
      occurredAt: row.occurredAt,
      capturedAt: row.capturedAt,
      contentSha256: row.contentSha256,
      attachmentSha256: null,
    });
    expect(Buffer.from(row.leafHash).equals(evidenceLeafHash(row.salt!, envelope))).toBe(true);
    expect(row.capturedAt.toISOString()).toBe(now.toISOString());
    // La charge brute n'est jamais en base.
    expect(JSON.stringify(row.payload)).not.toContain("contenu brut");
  });

  it("chiffre la charge brute avec la clé de l'organisation, en stockage objet", async () => {
    const { id } = await create(A, input(2));
    const row = await forOrg(A).evidenceItem.findUniqueOrThrow({ where: { id } });
    expect(row.rawObjectKey).toBe(rawObjectKey(A, id));
    const sealed = await store.get(row.rawObjectKey!);
    expect(sealed!.toString("utf8")).not.toContain("contenu brut");
    const key = await forOrg(A).orgEncryptionKey.findUniqueOrThrow({ where: { orgId: A } });
    expect(key.kekId).toBe("test");
    const dek = unwrapKey(master, key.wrappedDek, A);
    expect(JSON.parse(decrypt(dek, sealed!, `raw:${A}:${id}`).toString("utf8"))).toEqual(
      input(2).raw,
    );
  });

  it("ignore un doublon sans erreur ; deux organisations ont chacune leur preuve", async () => {
    const first = await create(A, input(3));
    const again = await create(A, { ...input(3), summary: "rejouée" });
    expect(again).toEqual({ id: first.id, created: false });
    expect(await forOrg(A).evidenceItem.count({ where: { dedupeKey: input(3).dedupeKey } })).toBe(
      1,
    );
    const other = await create(B, input(3));
    expect(other.created).toBe(true);
    expect(await forOrg(B).evidenceItem.count()).toBe(1);
  });
});

describe("immutabilité (trigger evidence_guard, §4.3.3)", () => {
  const errorOf = (p: Promise<unknown>) =>
    p.then(
      () => "",
      (e: Error) => e.message,
    );

  it("refuse la modification d'un champ scellé et toute charge autre que NULL", async () => {
    const { id } = await create(A, input(4));
    const db = forOrg(A);
    for (const data of [
      { kind: "autre" },
      { occurredAt: new Date() },
      { sourceRef: "x" },
      { leafHash: new Uint8Array(32) },
      { contentSha256: new Uint8Array(32) },
    ]) {
      expect(await errorOf(db.evidenceItem.update({ where: { id }, data }))).toContain(
        "champ scellé non modifiable",
      );
    }
    expect(
      await errorOf(db.evidenceItem.update({ where: { id }, data: { payload: { number: 99 } } })),
    ).toContain("seule la mise à NULL");
  });

  it("autorise l'effacement (charge, acteur, sel à NULL) ; la feuille reste", async () => {
    const { id } = await create(A, input(5));
    const db = forOrg(A);
    const before = await db.evidenceItem.findUniqueOrThrow({ where: { id } });
    await db.evidenceItem.update({
      where: { id },
      data: {
        payload: Prisma.DbNull,
        actor: Prisma.DbNull,
        salt: null,
        rawObjectKey: null,
        redactedAt: new Date(),
      },
    });
    const after = await db.evidenceItem.findUniqueOrThrow({ where: { id } });
    expect(after.payload).toBeNull();
    expect(after.salt).toBeNull();
    expect(Buffer.from(after.leafHash).equals(Buffer.from(before.leafHash))).toBe(true);
  });

  it("refuse la suppression, au rôle applicatif comme au propriétaire hors purge", async () => {
    const { id } = await create(A, input(6));
    expect(await errorOf(forOrg(A).evidenceItem.delete({ where: { id } }))).toMatch(
      /permission denied|denied/iu,
    );
    const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
    await client.connect();
    const error = await client.query(`DELETE FROM "EvidenceItem" WHERE id = $1`, [id]).then(
      () => "",
      (e: Error) => e.message,
    );
    await client.end();
    expect(error).toContain("EvidenceItem est en ajout seul");
  });

  it("le scellement s'écrit une fois, puis ne change plus", async () => {
    const { id } = await create(A, input(7));
    const client = new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
    await client.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.org_id', $1, TRUE)", [A]);
      await client.query(
        `INSERT INTO "SealBatch" (id, "orgId", seq, "leafCount", "merkleRoot", "prevBatchHash", "batchHash", "sealedAt")
         VALUES ($1, $2, 1, 1, $3, $3, $3, now())`,
        [`sb_${run}`, A, Buffer.alloc(32)],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      await client.end();
    }
    const db = forOrg(A);
    await db.evidenceItem.update({
      where: { id },
      data: { sealBatchId: `sb_${run}`, leafIndex: 0 },
    });
    expect(
      await errorOf(db.evidenceItem.update({ where: { id }, data: { sealBatchId: null } })),
    ).toContain("preuve déjà scellée");
  });
});
