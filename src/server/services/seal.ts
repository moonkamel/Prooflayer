// Scellement par lots (PL-501, §4.6.2 étape 2) : chaque heure et par organisation, les preuves non scellées sont triées
// par (capturedAt, id), leur racine de Merkle calculée, le lot chaîné au précédent ; lot et rattachement des preuves
// sont écrits dans une seule transaction. Un verrou consultatif par organisation garde `seq` continu même si deux
// scellements tournent en même temps (le second attend, puis ne trouve que ce qui reste).
// S'exécute dans une transaction où app.org_id est positionné (job `seal.org`).
import type { OrgTransaction } from "@/server/db";
import { batchHash, batchHeader, sortForSealing, ZERO_HASH } from "@/server/seal/batch";

/** Feuilles au plus par lot : une transaction courte, même après un long rattrapage. */
export const SEAL_MAX_LEAVES = 5_000;

export interface SealedBatch {
  id: string;
  seq: number;
  leafCount: number;
  batchHash: string;
}

export async function sealOrg(
  tx: OrgTransaction,
  orgId: string,
  now: Date,
  maxLeaves = SEAL_MAX_LEAVES,
): Promise<SealedBatch | null> {
  // Verrou de transaction : relâché à la validation ou à l'annulation.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`seal:${orgId}`}, 0))`;
  const pending = await tx.evidenceItem.findMany({
    where: { orgId, sealBatchId: null },
    select: { id: true, capturedAt: true, leafHash: true },
    orderBy: [{ capturedAt: "asc" }, { id: "asc" }],
    take: maxLeaves,
  });
  if (pending.length === 0) return null;
  const leaves = sortForSealing(pending);
  const previous = await tx.sealBatch.findFirst({
    where: { orgId },
    orderBy: { seq: "desc" },
    select: { seq: true, batchHash: true },
  });
  const header = batchHeader({
    orgId,
    seq: (previous?.seq ?? 0) + 1,
    leafHashes: leaves.map((l) => l.leafHash),
    prevBatchHash: previous ? previous.batchHash : ZERO_HASH,
    sealedAt: now,
  });
  const hash = batchHash(header);
  const batch = await tx.sealBatch.create({
    data: {
      orgId,
      seq: header.seq,
      leafCount: header.leafCount,
      merkleRoot: new Uint8Array(Buffer.from(header.merkleRoot, "hex")),
      prevBatchHash: new Uint8Array(Buffer.from(header.prevBatchHash, "hex")),
      batchHash: new Uint8Array(hash),
      sealedAt: now,
    },
    select: { id: true },
  });
  const ids = leaves.map((l) => l.id);
  const indexes = leaves.map((_, i) => i);
  const updated = await tx.$executeRaw`
    UPDATE "EvidenceItem" AS e SET "sealBatchId" = ${batch.id}, "leafIndex" = u.idx
    FROM unnest(${ids}::text[], ${indexes}::int[]) AS u(id, idx)
    WHERE e.id = u.id AND e."orgId" = ${orgId} AND e."sealBatchId" IS NULL`;
  // Sous le verrou, aucune preuve lue ne peut avoir été scellée ailleurs : un écart annule tout.
  if (updated !== leaves.length) throw new Error("scellement incomplet : lot annulé");
  return {
    id: batch.id,
    seq: header.seq,
    leafCount: header.leafCount,
    batchHash: hash.toString("hex"),
  };
}
