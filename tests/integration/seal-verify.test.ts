// PL-503 — Preuve d'inclusion et revérification quotidienne sur base réelle : `evidence.proof` (non scellée, scellée
// sans ancre, ancrée jusqu'au jeton), état de scellement sur l'écran D ; revérification d'une organisation (aucune
// anomalie, puis charge altérée et racine de lot altérée détectées, alerte), revérification des ancres et de leurs
// jetons ; programmation quotidienne dédupliquée. La corruption est simulée sous le rôle propriétaire, déclencheurs
// désactivés pour la seule session (`session_replication_role = replica`).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";
import * as pkijs from "pkijs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { forOrg, prisma, withOrgTransaction } from "@/server/db";
import { LIBRARY_VERSION } from "@/server/rules/library";
import { createCaller } from "@/server/routers/_app";
import { verifyProof } from "@/server/seal/chain";
import { FREETSA } from "@/server/seal/tsa-config";
import { verifyOrgChain } from "@/server/services/chain-verification";
import { createEvidence } from "@/server/services/evidence";
import { sealOrg } from "@/server/services/seal";
import { anchorPendingBatches, type Timestamper } from "@/server/system/anchoring";
import { verifyAnchors } from "@/server/system/chain-verification";
import { jobRegistry } from "@/server/system/jobs/handlers";
import { runJobNow } from "@/server/system/jobs/queue";
import { scheduleChainVerification } from "@/server/system/seal-schedule";

const run = randomUUID().slice(0, 8);
const A = `org_sver_${run}`;
const owner = `usr_sver_${run}`;
const ids: string[] = [];
let controlId = "";
let systemId = "";
let anchorSeq = 0;
const direct = () => new pg.Client({ connectionString: process.env.DIRECT_DATABASE_URL });
const api = () =>
  createCaller({ headers: new Headers(), session: { userId: owner, activeOrganizationId: A } });
/** Jeton réel (TimeStampToken) extrait de la réponse enregistrée : il horodate une autre empreinte. */
const response = new Uint8Array(
  readFileSync(join(process.cwd(), "tests/fixtures/tsa/response.tsr")),
);
const token = new Uint8Array(
  pkijs.TimeStampResp.fromBER(response.buffer.slice(0) as ArrayBuffer)
    .timeStampToken!.toSchema()
    .toBER(false),
);

/** Prestataire simulé, enregistré sous le nom de freetsa : son jeton (d'une autre empreinte) doit être refusé. */
const fakeTsa: Timestamper = {
  name: FREETSA.name,
  timestamp: async () => ({ token, genTime: new Date(), serial: "01", policyOid: "1.2.3" }),
};

async function addEvidence(n: number) {
  await withOrgTransaction(A, async (tx) => {
    for (let i = 0; i < n; i++) {
      const created = await createEvidence(tx, A, {
        kind: "github.pull_request.merged",
        source: "GITHUB",
        capturedVia: "WEBHOOK",
        sourceRef: `pr:${run}:${ids.length}`,
        dedupeKey: `sver:${run}:${ids.length}`,
        occurredAt: new Date(),
        summary: `PR #${ids.length}`,
        payload: { number: ids.length, approvals: 1 },
      });
      ids.push(created.id);
    }
  });
}

/** Sous le rôle propriétaire, déclencheurs désactivés pour cette seule session. */
async function corrupt(sql: string, params: unknown[]) {
  const client = direct();
  await client.connect();
  try {
    await client.query("SET session_replication_role = replica");
    await client.query(sql, params);
  } finally {
    await client.end();
  }
}

beforeAll(async () => {
  await prisma.organization.create({ data: { id: A, name: A, slug: A } });
  await prisma.user.create({ data: { id: owner, email: `${owner}@sver.test`, name: "Clara" } });
  await prisma.member.create({
    data: { id: `mem_${owner}`, organizationId: A, userId: owner, role: "owner" },
  });
  systemId = (
    await forOrg(A).aiSystem.create({
      data: {
        monitored: true,
        orgId: A,
        name: "Score",
        slug: `score-${run}`,
        intendedPurpose: "T",
        ownerUserId: owner,
        models: [],
      },
    })
  ).id;
  const definition = await prisma.controlDefinition.findFirstOrThrow({
    where: { key: "AIA-15-02", libraryVersion: LIBRARY_VERSION },
  });
  controlId = (
    await forOrg(A).controlInstance.create({
      data: { orgId: A, systemId, definitionId: definition.id },
    })
  ).id;
  await addEvidence(5);
  await forOrg(A).evidenceLink.createMany({
    data: ids.map((evidenceId) => ({ evidenceId, controlInstanceId: controlId, orgId: A })),
  });
});

afterAll(async () => {
  const client = direct();
  await client.connect();
  try {
    await client.query(
      `DELETE FROM "Job" WHERE "orgId" = $1 OR "dedupeKey" LIKE 'seal.verifyAnchors:%'`,
      [A],
    );
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.purge_org', $1, TRUE)", [A]);
    await client.query(`DELETE FROM "EvidenceItem" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "SealBatch" WHERE "orgId" = $1`, [A]);
    await client.query(`DELETE FROM "Organization" WHERE id = $1`, [A]);
    await client.query(`DELETE FROM "User" WHERE id = $1`, [owner]);
    await client.query("COMMIT");
  } finally {
    await client.end();
  }
  await prisma.$disconnect();
});

describe("evidence.proof", () => {
  it("non scellée : le dit ; preuve inconnue ou d'une autre organisation : introuvable", async () => {
    expect(await api().evidence.proof({ evidenceId: ids[0]! })).toEqual({
      sealed: false,
      evidenceId: ids[0],
    });
    await expect(api().evidence.proof({ evidenceId: "ev_inconnue" })).rejects.toThrow(
      "evidence.notFound",
    );
  });

  it("scellée sans ancre : chemin jusqu'au lot ; ancrée : chemin jusqu'au jeton", async () => {
    await withOrgTransaction(A, (tx) => sealOrg(tx, A, new Date()));
    const sealed = await api().evidence.proof({ evidenceId: ids[2]! });
    expect(sealed).toMatchObject({ sealed: true, anchored: false });
    if (!sealed.sealed) throw new Error("scellée attendue");
    expect(verifyProof(sealed.proof)).toEqual({ ok: true });

    const outcome = await prisma.$transaction(
      (tx) => anchorPendingBatches(tx, new Date(), fakeTsa),
      {
        timeout: 30_000,
      },
    );
    anchorSeq = outcome!.seq;
    for (const id of ids) {
      const result = await api().evidence.proof({ evidenceId: id });
      if (!result.sealed) throw new Error("scellée attendue");
      expect(result.anchored).toBe(true);
      expect(verifyProof(result.proof)).toEqual({ ok: true });
      expect(result.proof.anchor!.header.seq).toBe(anchorSeq);
      expect(Buffer.from(result.proof.anchor!.tsa.token, "base64").equals(Buffer.from(token))).toBe(
        true,
      );
    }
  });

  it("écran D : empreinte, lot, ancre et date du jeton de chaque preuve", async () => {
    const control = await api().control.get({ controlId });
    expect(control.evidence.items).toHaveLength(5);
    for (const item of control.evidence.items) {
      expect(item.seal.leafHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(item.seal.batch?.seq).toBe(1);
      expect(item.seal.anchor).toMatchObject({ seq: anchorSeq, tsaName: FREETSA.name });
    }
  });
});

describe("revérification quotidienne", () => {
  it("organisation intègre : aucune anomalie", async () => {
    const report = await withOrgTransaction(A, (tx) => verifyOrgChain(tx, A));
    expect(report).toMatchObject({ batches: 1, leaves: 5, issues: [] });
  });

  it("ancres : jeton qui n'horodate pas l'anchorHash détecté", async () => {
    const { issues } = await prisma.$transaction((tx) => verifyAnchors(tx), { timeout: 60_000 });
    const ours = issues.filter((i) => "seq" in i && i.seq === anchorSeq);
    expect(ours).toEqual([{ kind: "anchorToken", seq: anchorSeq, reason: "imprint_mismatch" }]);
  });

  it("charge altérée et racine de lot altérée : détectées, alerte sans contenu", async () => {
    await corrupt(
      `UPDATE "EvidenceItem" SET payload = '{"number": 99, "approvals": 1}' WHERE id = $1`,
      [ids[1]],
    );
    await corrupt(
      `UPDATE "SealBatch" SET "merkleRoot" = sha256('x'::bytea) WHERE "orgId" = $1 AND seq = 1`,
      [A],
    );
    const report = await withOrgTransaction(A, (tx) => verifyOrgChain(tx, A));
    expect(report.issues).toEqual(
      expect.arrayContaining([
        { kind: "content", evidenceId: ids[1] },
        { kind: "batchRoot", seq: 1 },
        { kind: "batchHash", seq: 1 },
      ]),
    );

    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const day = new Date().toISOString().slice(0, 10);
    await scheduleChainVerification();
    expect((await scheduleChainVerification()).scheduled).toBe(0);
    const job = await prisma.job.findFirstOrThrow({
      where: { dedupeKey: `seal.verifyOrg:${A}:${day}` },
    });
    expect(await runJobNow(job.id, jobRegistry)).toBe("done");
    const lines = spy.mock.calls.map(([l]) => String(l)).join("\n");
    spy.mockRestore();
    expect(lines).toContain("seal.integrityFailure");
    expect(lines).toContain(`content:${ids[1]}`);
    expect(lines).not.toContain("approvals");
  });
});
