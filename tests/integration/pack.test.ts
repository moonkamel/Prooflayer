// PL-504 — Pack d'audit sur base réelle : création (admin), génération par le job (scellement des preuves en attente,
// ancrage immédiat, rapport, archive, signature, notification), contenu vérifié de bout en bout (signature, empreinte de
// chaque fichier, feuilles recalculées, racine des lots, preuve non divulguée comptée, pièce jointe en clair, contrôles
// en échec et sans preuve présents), téléchargement par un auditeur, clé publique publiée ; 2 000 preuves en moins de
// 3 minutes.
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import * as pkijs from "pkijs";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateKey, masterKeyFromEnv } from "@/server/crypto/envelope";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { unzipPack } from "@/server/pack/archive";
import { packSigningKey, verifyManifestSignature } from "@/server/pack/signing";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { createCaller } from "@/server/routers/_app";
import { batchHash } from "@/server/seal/batch";
import { contentSha256, envelopeOf, evidenceLeafHash } from "@/server/seal/evidence";
import { merkleRoot } from "@/server/seal/merkle";
import { FREETSA } from "@/server/seal/tsa-config";
import { createEvidence } from "@/server/services/evidence";
import { packStorage, type PackDependencies } from "@/server/services/packs";
import { LocalObjectStore } from "@/server/storage/object-store";
import type { Timestamper } from "@/server/system/anchoring";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { packJobDependencies } from "@/server/system/jobs/pack";
import { runJobNow } from "@/server/system/jobs/queue";
import { publishedSigningKeys } from "@/server/system/signing-keys";

const run = randomUUID().slice(0, 8);
const A = `org_pack_${run}`;
const admin = `usr_pack_admin_${run}`;
const auditor = `usr_pack_aud_${run}`;
let dir = "";
let systemId = "";
let otherSystemId = "";
const instances: Record<string, string> = {};
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
const as = (userId: string) =>
  createCaller({ headers: new Headers(), session: { userId, activeOrganizationId: A } });
const today = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

const fixture = new Uint8Array(
  readFileSync(join(process.cwd(), "tests/fixtures/tsa/response.tsr")),
);
const fixtureToken = new Uint8Array(
  pkijs.TimeStampResp.fromBER(fixture.buffer.slice(0) as ArrayBuffer)
    .timeStampToken!.toSchema()
    .toBER(false),
);
const fakeTsa: Timestamper = {
  name: FREETSA.name,
  timestamp: async () => ({
    token: fixtureToken,
    genTime: new Date(),
    serial: "01",
    policyOid: "1.2.3",
  }),
};

let deps: PackDependencies;

async function addEvidence(controlKey: string | null, n: number, attachment?: Buffer) {
  return withOrgTransaction(A, async (tx) => {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const created = await createEvidence(
        tx,
        A,
        {
          kind: attachment ? "manual.upload" : "github.pull_request.merged",
          source: attachment ? "MANUAL" : "GITHUB",
          capturedVia: attachment ? "UPLOAD" : "WEBHOOK",
          sourceRef: `ref:${run}:${controlKey}:${i}:${randomUUID()}`,
          dedupeKey: `pack:${run}:${randomUUID()}`,
          occurredAt: new Date(),
          summary: attachment ? "Déclaration UE de conformité" : `PR #${i}`,
          payload: { n: i, control: controlKey },
          declarative: Boolean(attachment),
          ...(attachment ? { attachment: { data: attachment, mime: "application/pdf" } } : {}),
        },
        { store: deps.store, master: masterKeyFromEnv() },
      );
      ids.push(created.id);
    }
    if (controlKey) {
      await tx.evidenceLink.createMany({
        data: ids.map((evidenceId) => ({
          evidenceId,
          controlInstanceId: instances[controlKey]!,
          orgId: A,
          linkedBy: admin,
        })),
      });
    }
    return ids;
  });
}

beforeAll(async () => {
  process.env.PROOFLAYER_MASTER_KEY ??= generateKey().toString("base64");
  dir = await mkdtemp(join(tmpdir(), "pl-pack-"));
  deps = {
    store: new LocalObjectStore(dir, "secret-pack-0123456789"),
    master: () => masterKeyFromEnv(),
    signingKey: () => packSigningKey({ BETTER_AUTH_SECRET: "secret-pack-test-0123456789" }),
    timestamper: () => fakeTsa,
    baseUrl: "https://app.example.test",
    now: () => new Date(),
  };
  packJobDependencies.get = () => deps;
  packStorage.store = () => deps.store;
  await prisma.organization.create({ data: { id: A, name: "Talvio", slug: A } });
  for (const [id, role] of [
    [admin, "admin"],
    [auditor, "auditor"],
  ] as const) {
    await prisma.user.create({ data: { id, email: `${id}@pack.test`, name: `Nom ${role}` } });
    await prisma.member.create({ data: { id: `mem_${id}`, organizationId: A, userId: id, role } });
  }
  const db = forOrg(A);
  for (const [name, set] of [
    ["Score", (v: string) => (systemId = v)],
    ["Autre", (v: string) => (otherSystemId = v)],
  ] as const) {
    set(
      (
        await db.aiSystem.create({
          data: {
            orgId: A,
            name,
            slug: `${name.toLowerCase()}-${run}`,
            intendedPurpose: "Classer des candidatures",
            ownerUserId: admin,
            models: [],
            riskTier: "HIGH_RISK",
            role: "PROVIDER",
          },
        })
      ).id,
    );
  }
  await db.classification.create({
    data: {
      orgId: A,
      systemId,
      rulesetVersion: "2026.11.0",
      answers: {},
      tier: "HIGH_RISK",
      role: "PROVIDER",
      annexIIIPoints: ["4(a)"],
      reasoning: [],
      status: "SIGNED",
      signedByUserId: admin,
      signedByName: "Clara Martin",
      signedByTitle: "CTO",
      signedAt: new Date(),
    },
  });
  const definitions = await prisma.controlDefinition.findMany({
    where: {
      key: { in: ["AIA-15-02", "AIA-47-01", "AIA-13-01"] },
      libraryVersion: LIBRARY_VERSION,
    },
  });
  for (const d of definitions) {
    instances[d.key] = (
      await db.controlInstance.create({
        data: {
          orgId: A,
          systemId,
          definitionId: d.id,
          status: d.key === "AIA-15-02" ? "FAIL" : d.key === "AIA-47-01" ? "PASS" : "MISSING",
        },
      })
    ).id;
  }
  await addEvidence("AIA-15-02", 4);
  await addEvidence("AIA-47-01", 1, Buffer.from("%PDF-1.7\nDéclaration UE signée\n%%EOF"));
  // Preuve d'un autre système de l'organisation : scellée dans les mêmes lots, non divulguée.
  await addEvidence(null, 1);
});

afterAll(async () => {
  const client = direct();
  await client.connect();
  try {
    await client.query(`DELETE FROM "Job" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Notification" WHERE "orgId" = $1`, [A]);
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "AuditLog" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "SealBatch" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Classification" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = ANY($1)`, [[admin, auditor]]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await rm(dir, { recursive: true, force: true });
  await prisma.$disconnect();
});

async function generate(periodStart = start, periodEnd = today) {
  const { id } = await as(admin).pack.create({ systemId, periodStart, periodEnd, language: "fr" });
  const job = await prisma.job.findFirstOrThrow({ where: { dedupeKey: `pack.build:${id}` } });
  const outcome = await runJobNow(job.id, jobRegistry);
  if (outcome !== "done") {
    const after = await prisma.job.findUniqueOrThrow({ where: { id: job.id } });
    throw new Error(`pack.build ${outcome} : ${after.lastError}`);
  }
  return id;
}

describe("génération", () => {
  it("période invalide refusée ; seul un administrateur génère", async () => {
    await expect(
      as(admin).pack.create({ systemId, periodStart: today, periodEnd: start, language: "fr" }),
    ).rejects.toThrow("pack.invalidPeriod");
    await expect(
      as(auditor).pack.create({ systemId, periodStart: start, periodEnd: today, language: "fr" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("aperçu : contrôles, en échec, sans preuve, preuves de la période", async () => {
    expect(
      await as(admin).pack.preview({ systemId, periodStart: start, periodEnd: today }),
    ).toEqual({
      controls: 3,
      failing: 1,
      missing: 1,
      evidence: 5,
    });
  });

  let packId = "";
  let entries: Map<string, Uint8Array>;

  it("le job scelle, ancre, signe et écrit l'archive ; le demandeur est prévenu", async () => {
    packId = await generate();
    const pack = await as(auditor).pack.get({ packId });
    expect(pack).toMatchObject({ status: "READY", evidenceCount: 5, signingKid: "pl-dev" });
    expect(pack.lastAnchorSeq).not.toBeNull();
    expect(await as(auditor).pack.downloadUrl({ packId })).toEqual({
      url: `/api/packs/${packId}/download`,
    });
    const { bytes, filename } = await as(auditor).pack.download({ packId });
    expect(filename).toMatch(/^pack-score-.*\.zip$/u);
    entries = unzipPack(new Uint8Array(bytes));
    // Exemple à relire à l'œil : PACK_SAMPLE_OUT=<chemin>.zip pnpm exec vitest … pack.test.ts
    if (process.env.PACK_SAMPLE_OUT) await writeFile(process.env.PACK_SAMPLE_OUT, bytes);
    const notification = await forOrg(A).notification.findFirstOrThrow({
      where: { type: "pack.ready" },
    });
    expect(notification).toMatchObject({ userId: admin });
    expect(await forOrg(A).auditLog.count({ where: { action: "pack.download" } })).toBe(1);
  });

  it("contenu vérifiable de bout en bout", async () => {
    const manifest = JSON.parse(Buffer.from(entries.get("manifest.json")!).toString());
    // 1. Signature, contre la clé publiée.
    const published = await publishedSigningKeys({});
    const keys = new Map(published.map((k) => [k.kid, Buffer.from(k.publicKey, "base64")]));
    expect(verifyManifestSignature(manifest, keys)).toBe(true);
    // 2. Empreinte de chaque fichier.
    for (const f of manifest.files) expect(sha(entries.get(f.path)!), f.path).toBe(f.sha256);
    expect(manifest.files.map((f: { path: string }) => f.path)).toEqual(
      expect.arrayContaining(["report.pdf", "controls.json", "VERIFY.md"]),
    );
    expect(Buffer.from(entries.get("report.pdf")!).subarray(0, 5).toString()).toBe("%PDF-");
    // 3. Chaque preuve divulguée recalcule sa feuille, présente dans son lot.
    const batches = new Map<
      number,
      { header: { merkleRoot: string; leafCount: number }; batchHash: string; leafHashes: string[] }
    >();
    for (const [path, bytes] of entries) {
      if (path.startsWith("proofs/batches/"))
        batches.set(Number(path.slice(15, -5)), JSON.parse(Buffer.from(bytes).toString()));
    }
    const evidenceFiles = [...entries.keys()].filter((p) => /^evidence\/[^/]+\.json$/u.test(p));
    expect(evidenceFiles).toHaveLength(5);
    for (const path of evidenceFiles) {
      const e = JSON.parse(Buffer.from(entries.get(path)!).toString());
      expect(contentSha256(e.payload).toString("hex")).toBe(e.contentSha256);
      const leaf = evidenceLeafHash(
        Buffer.from(e.salt, "hex"),
        envelopeOf({
          orgId: A,
          id: e.id,
          kind: e.kind,
          sourceRef: e.sourceRef,
          occurredAt: new Date(e.occurredAt),
          capturedAt: new Date(e.capturedAt),
          contentSha256: Buffer.from(e.contentSha256, "hex"),
          attachmentSha256: e.attachmentSha256 ? Buffer.from(e.attachmentSha256, "hex") : null,
        }),
      );
      expect(batches.get(e.seal.batch)!.leafHashes[e.seal.leafIndex]).toBe(leaf.toString("hex"));
      if (e.attachment) {
        expect(e.declarative).toBe(true);
        expect(sha(entries.get(e.attachment.path)!)).toBe(e.attachmentSha256);
      }
    }
    // 4. Racine et empreinte de chaque lot ; la preuve de l'autre système n'est que comptée.
    for (const b of batches.values()) {
      expect(merkleRoot(b.leafHashes.map((h) => Buffer.from(h, "hex"))).toString("hex")).toBe(
        b.header.merkleRoot,
      );
      expect(batchHash(b.header as never).toString("hex")).toBe(b.batchHash);
    }
    expect(manifest.counts).toMatchObject({
      controls: 3,
      failing: 1,
      missing: 1,
      disclosed: 5,
      undisclosed: 1,
    });
    // 5. Ancre et jeton joints.
    expect([...entries.keys()].some((p) => p.endsWith(".tst"))).toBe(true);
    expect(entries.has("proofs/tsa/freetsa.pem")).toBe(true);
    // Contrôles en échec et sans preuve toujours présents.
    const controls = JSON.parse(Buffer.from(entries.get("controls.json")!).toString());
    expect(controls.map((c: { key: string; status: string }) => `${c.key}:${c.status}`)).toEqual([
      "AIA-13-01:MISSING",
      "AIA-15-02:FAIL",
      "AIA-47-01:PASS",
    ]);
    expect(Buffer.from(entries.get("VERIFY.md")!).toString()).toContain("openssl ts -verify");
  });

  it("un octet modifié dans une preuve ne correspond plus au manifeste", () => {
    const manifest = JSON.parse(Buffer.from(entries.get("manifest.json")!).toString());
    const path = [...entries.keys()].find((p) => /^evidence\/[^/]+\.json$/u.test(p))!;
    const tampered = Buffer.from(entries.get(path)!);
    tampered[tampered.length - 3] = tampered[tampered.length - 3]! ^ 1;
    expect(sha(tampered)).not.toBe(
      manifest.files.find((f: { path: string }) => f.path === path).sha256,
    );
  });

  it("2 000 preuves : pack généré en moins de 3 minutes", { timeout: 200_000 }, async () => {
    const client = direct();
    await client.connect();
    try {
      await client.query(
        `INSERT INTO "EvidenceItem" (id, "orgId", kind, source, "capturedVia", "sourceRef", "dedupeKey", "occurredAt",
           summary, payload, "contentSha256", "leafHash")
         SELECT 'ev_perf_' || $2 || '_' || g, $1, 'github.pull_request.merged', 'GITHUB', 'WEBHOOK', 'perf' || g,
           'perf:' || $2 || ':' || g, now(), 'PR #' || g, jsonb_build_object('n', g),
           sha256(convert_to('c' || g, 'UTF8')), sha256(convert_to($2 || ':perf:' || g, 'UTF8'))
         FROM generate_series(1, 2000) g`,
        [A, run],
      );
      await client.query(
        `INSERT INTO "EvidenceLink" ("evidenceId", "controlInstanceId", "orgId", "linkedBy")
         SELECT 'ev_perf_' || $2 || '_' || g, $3, $1, 'rule' FROM generate_series(1, 2000) g`,
        [A, run, instances["AIA-15-02"]],
      );
    } finally {
      await client.end();
    }
    const started = performance.now();
    const id = await generate();
    const elapsed = performance.now() - started;
    expect((await as(admin).pack.get({ packId: id })).status).toBe("READY");
    expect(elapsed).toBeLessThan(180_000);
    expect((await as(admin).pack.get({ packId: id })).evidenceCount).toBeGreaterThanOrEqual(2005);
  });
});

describe("liste", () => {
  it("packs du système, les plus récents d'abord ; autre système : aucun", async () => {
    const packs = await as(auditor).pack.list({ systemId });
    expect(packs.length).toBeGreaterThanOrEqual(2);
    expect(packs.every((p) => p.status === "READY")).toBe(true);
    expect(await as(auditor).pack.list({ systemId: otherSystemId })).toEqual([]);
  });
});
