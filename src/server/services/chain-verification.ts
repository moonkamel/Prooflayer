// Revérification quotidienne de la chaîne d'une organisation (PL-503) : chaque preuve scellée (contenu, feuille),
// chaque lot (racine, nombre de feuilles, empreinte, chaînage) et son rattachement à l'ancre (le batchHash est bien la
// feuille de l'ancre à sa position). Les ancres elles-mêmes, communes, sont revérifiées par src/server/system/
// chain-verification.ts. S'exécute dans une transaction où app.org_id est positionné (job `seal.verifyOrg`).
import type { OrgTransaction } from "@/server/db";
import { batchIssues, leafIssues, type IntegrityIssue } from "@/server/seal/chain";

/** Lots revérifiés par page. */
const PAGE = 50;

export type OrgIntegrityIssue = IntegrityIssue | { kind: "batchAnchor"; seq: number };

export async function verifyOrgChain(tx: OrgTransaction, orgId: string) {
  const issues: OrgIntegrityIssue[] = [];
  let leaves = 0;
  let batches = 0;
  let cursor = 0;
  const chain: Parameters<typeof batchIssues>[0][number][] = [];
  for (;;) {
    const page = await tx.sealBatch.findMany({
      where: { orgId, seq: { gt: cursor } },
      orderBy: { seq: "asc" },
      take: PAGE,
      include: { anchor: { select: { batchHashes: true } } },
    });
    if (page.length === 0) break;
    for (const batch of page) {
      const items = await tx.evidenceItem.findMany({
        where: { sealBatchId: batch.id },
        orderBy: { leafIndex: "asc" },
        select: {
          id: true,
          orgId: true,
          kind: true,
          sourceRef: true,
          occurredAt: true,
          capturedAt: true,
          contentSha256: true,
          attachmentSha256: true,
          salt: true,
          leafHash: true,
          payload: true,
        },
      });
      for (const item of items) issues.push(...leafIssues(item));
      if (batch.anchor && batch.anchorLeafIndex !== null) {
        const leaf = batch.anchor.batchHashes[batch.anchorLeafIndex];
        if (!leaf || !Buffer.from(leaf).equals(Buffer.from(batch.batchHash))) {
          issues.push({ kind: "batchAnchor", seq: batch.seq });
        }
      }
      // La chaîne est vérifiée en entier à la fin : on n'en garde que l'en-tête et les feuilles.
      chain.push({ ...batch, leaves: items.map((i) => i.leafHash) });
      leaves += items.length;
      batches += 1;
    }
    cursor = page.at(-1)!.seq;
  }
  issues.push(...batchIssues(chain));
  return { batches, leaves, issues };
}
