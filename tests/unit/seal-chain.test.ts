// PL-503 — Preuve d'inclusion jusqu'au jeton et revérification de la chaîne (fonctions pures) : chemin valide ;
// altération de la feuille, du chemin, de l'en-tête du lot ou de l'ancre détectée ; contenu, feuille, lot, chaînage
// et ancre recalculés.
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { anchorHash, anchorHeader, sortBatchesForAnchor } from "@/server/seal/anchor";
import { batchHash, batchHeader, ZERO_HASH } from "@/server/seal/batch";
import {
  anchorIssues,
  batchIssues,
  buildProof,
  leafIssues,
  verifyProof,
  type StoredAnchor,
  type StoredBatch,
} from "@/server/seal/chain";
import { contentSha256, envelopeOf, evidenceLeafHash } from "@/server/seal/evidence";

const at = new Date("2026-11-13T13:00:00.000Z");

function evidence(i: number) {
  const payload = { n: i, title: `PR ${i}` };
  const salt = randomBytes(32);
  const base = {
    orgId: "org_1",
    id: `ev_${i}`,
    kind: "github.pull_request.merged",
    sourceRef: `pr:${i}`,
    occurredAt: at,
    capturedAt: new Date(at.getTime() + i),
    contentSha256: contentSha256(payload),
    attachmentSha256: null,
  };
  return { ...base, payload, salt, leafHash: evidenceLeafHash(salt, envelopeOf(base)) };
}

function chain(sizes: number[]) {
  const batches: (StoredBatch & { leaves: Buffer[] })[] = [];
  let prev: Buffer = ZERO_HASH;
  let n = 0;
  for (const [i, size] of sizes.entries()) {
    const leaves = Array.from({ length: size }, () => evidence(n++).leafHash);
    const header = batchHeader({
      orgId: "org_1",
      seq: i + 1,
      leafHashes: leaves,
      prevBatchHash: prev,
      sealedAt: at,
    });
    const hash = batchHash(header);
    batches.push({
      orgId: "org_1",
      seq: i + 1,
      leafCount: size,
      merkleRoot: Buffer.from(header.merkleRoot, "hex"),
      prevBatchHash: prev,
      batchHash: hash,
      sealedAt: at,
      leaves,
    });
    prev = hash;
  }
  return batches;
}

function anchorOver(batchHashes: Uint8Array[], seq = 1, prev: Uint8Array = ZERO_HASH) {
  const sorted = sortBatchesForAnchor(batchHashes.map((h) => ({ batchHash: h }))).map(
    (b) => b.batchHash,
  );
  const header = anchorHeader({ seq, batchHashes: sorted, prevAnchorHash: prev });
  const stored: StoredAnchor & { batchHashes: Buffer[] } = {
    seq,
    batchCount: sorted.length,
    merkleRoot: Buffer.from(header.merkleRoot, "hex"),
    prevAnchorHash: prev,
    anchorHash: anchorHash(header),
    tsaName: "tsa-test",
    tsaPolicyOid: "1.2.3",
    tsaToken: Buffer.from("jeton"),
    tsaGenTime: at,
    batchHashes: sorted.map((h) => Buffer.from(h)),
  };
  return stored;
}

describe("preuve d'inclusion jusqu'au jeton", () => {
  const [batch] = chain([5]);
  const otherOrg = randomBytes(32);
  const anchor = anchorOver([batch!.batchHash, otherOrg]);
  const proofOf = (i: number) =>
    buildProof({
      evidence: { id: `ev_${i}`, leafHash: batch!.leaves[i]!, leafIndex: i },
      batch: batch!,
      batchLeaves: batch!.leaves,
      anchor: {
        ...anchor,
        batchLeafIndex: anchor.batchHashes.findIndex((h) =>
          h.equals(Buffer.from(batch!.batchHash)),
        ),
        batchLeaves: anchor.batchHashes,
      },
    });

  it("chaque preuve se vérifie, jusqu'à l'anchorHash ; le jeton est joint", () => {
    for (let i = 0; i < 5; i++) expect(verifyProof(proofOf(i))).toEqual({ ok: true });
    const p = proofOf(2);
    expect(p.anchor!.anchorHash).toBe(Buffer.from(anchor.anchorHash).toString("hex"));
    expect(Buffer.from(p.anchor!.tsa.token, "base64").toString()).toBe("jeton");
  });

  it("altérations détectées à l'étape fautive", () => {
    const p = proofOf(1);
    expect(verifyProof({ ...p, evidence: { ...p.evidence, leafHash: "00".repeat(32) } })).toEqual({
      ok: false,
      step: "leaf",
    });
    expect(verifyProof({ ...p, batch: { ...p.batch, path: p.batch.path.slice(1) } })).toEqual({
      ok: false,
      step: "leaf",
    });
    expect(
      verifyProof({
        ...p,
        batch: { ...p.batch, header: { ...p.batch.header, sealedAt: "2026-11-13T13:00:00.001Z" } },
      }),
    ).toEqual({
      ok: false,
      step: "batchHash",
    });
    expect(
      verifyProof({ ...p, anchor: { ...p.anchor!, leafIndex: 1 - p.anchor!.leafIndex } }),
    ).toEqual({
      ok: false,
      step: "anchorLeaf",
    });
    expect(
      verifyProof({ ...p, anchor: { ...p.anchor!, header: { ...p.anchor!.header, seq: 9 } } }),
    ).toEqual({
      ok: false,
      step: "anchorHash",
    });
  });

  it("lot pas encore ancré : chemin jusqu'au lot seulement", () => {
    const p = buildProof({
      evidence: { id: "ev_0", leafHash: batch!.leaves[0]!, leafIndex: 0 },
      batch: batch!,
      batchLeaves: batch!.leaves,
      anchor: null,
    });
    expect(p.anchor).toBeNull();
    expect(verifyProof(p)).toEqual({ ok: true });
  });
});

describe("revérification quotidienne", () => {
  it("feuille : contenu et leafHash recalculés ; une preuve effacée n'est vérifiée que par son leafHash", () => {
    const e = evidence(1);
    expect(leafIssues(e)).toEqual([]);
    expect(leafIssues({ ...e, payload: { ...e.payload, n: 2 } })).toEqual([
      { kind: "content", evidenceId: "ev_1" },
    ]);
    expect(leafIssues({ ...e, sourceRef: "pr:autre" })).toEqual([
      { kind: "leaf", evidenceId: "ev_1" },
    ]);
    expect(leafIssues({ ...e, payload: null, salt: null })).toEqual([]);
  });

  it("lots : racine, nombre de feuilles, empreinte, chaînage", () => {
    const batches = chain([3, 2, 4]);
    expect(batchIssues(batches)).toEqual([]);
    expect(batchIssues([batches[0]!, batches[2]!])).toEqual([{ kind: "batchChain", seq: 3 }]);
    const missingLeaf = batches.map((b, i) => (i === 1 ? { ...b, leaves: b.leaves.slice(1) } : b));
    expect(batchIssues(missingLeaf)).toEqual([
      { kind: "batchCount", seq: 2 },
      { kind: "batchRoot", seq: 2 },
    ]);
    const altered = batches.map((b, i) =>
      i === 0 ? { ...b, sealedAt: new Date(at.getTime() + 1) } : b,
    );
    expect(batchIssues(altered)).toEqual([{ kind: "batchHash", seq: 1 }]);
  });

  it("ancres : racine, nombre de lots, empreinte, chaînage", () => {
    const a1 = anchorOver([randomBytes(32), randomBytes(32)]);
    const a2 = anchorOver([randomBytes(32)], 2, a1.anchorHash);
    expect(anchorIssues([a1, a2])).toEqual([]);
    expect(anchorIssues([a2])).toEqual([{ kind: "anchorChain", seq: 2 }]);
    expect(anchorIssues([{ ...a1, batchHashes: a1.batchHashes.slice(1) }, a2])).toEqual([
      { kind: "anchorCount", seq: 1 },
      { kind: "anchorRoot", seq: 1 },
    ]);
    expect(
      anchorIssues([
        { ...a1, tsaName: "autre" },
        { ...a2, batchCount: 5 },
      ]),
    ).toEqual([
      { kind: "anchorCount", seq: 2 },
      { kind: "anchorHash", seq: 2 },
    ]);
  });
});
