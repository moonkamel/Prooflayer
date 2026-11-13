// Preuve d'inclusion d'une preuve (PL-503, routeur `evidence`, procédure `proof` du §4.4.2) : le chemin depuis sa
// feuille jusqu'au jeton d'horodatage de l'ancre. Lecture, tout membre. Une preuve pas encore scellée (au plus une
// heure) ou un lot pas encore ancré (au plus 6 heures) le disent (§4.6.4).
import { withOrgTransaction } from "@/server/db";
import { buildProof, type ProofBundle } from "@/server/seal/chain";
import { ServiceError } from "./errors";
import type { OrgContext } from "./organization";

export type EvidenceProofResult =
  { sealed: false; evidenceId: string } | { sealed: true; anchored: boolean; proof: ProofBundle };

export async function evidenceProof(
  ctx: OrgContext,
  input: { evidenceId: string },
): Promise<EvidenceProofResult> {
  return withOrgTransaction(ctx.orgId, async (tx) => {
    const evidence = await tx.evidenceItem.findFirst({
      where: { id: input.evidenceId, orgId: ctx.orgId },
      select: { id: true, leafHash: true, leafIndex: true, sealBatchId: true },
    });
    if (!evidence) throw new ServiceError("NOT_FOUND", "evidence.notFound");
    if (!evidence.sealBatchId || evidence.leafIndex === null) {
      return { sealed: false, evidenceId: evidence.id };
    }
    const batch = await tx.sealBatch.findUniqueOrThrow({
      where: { id: evidence.sealBatchId },
      include: { anchor: true },
    });
    const leaves = await tx.evidenceItem.findMany({
      where: { sealBatchId: batch.id },
      orderBy: { leafIndex: "asc" },
      select: { leafHash: true },
    });
    const anchor =
      batch.anchor && batch.anchorLeafIndex !== null
        ? {
            ...batch.anchor,
            batchLeafIndex: batch.anchorLeafIndex,
            batchLeaves: batch.anchor.batchHashes,
          }
        : null;
    return {
      sealed: true,
      anchored: anchor !== null,
      proof: buildProof({
        evidence: { id: evidence.id, leafHash: evidence.leafHash, leafIndex: evidence.leafIndex },
        batch,
        batchLeaves: leaves.map((l) => l.leafHash),
        anchor,
      }),
    };
  });
}
