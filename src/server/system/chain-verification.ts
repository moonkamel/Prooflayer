// Revérification quotidienne (PL-503) : ancres communes (racine sur leurs batchHash, empreinte, chaînage, jeton RFC 3161
// revérifié hors ligne contre la racine du prestataire qui l'a émis) ; la programmation vit dans seal-schedule.ts. Toute incohérence lève
// l'alerte d'exploitation `seal.integrityFailure` (codes et numéros, jamais de contenu).
import type { Prisma } from "@/generated/prisma/client";
import { anchorIssues, type IntegrityIssue } from "@/server/seal/chain";
import { certificatesFromPem, TsaError, verifyTimestamp } from "@/server/seal/tsa";
import { FREETSA, FREETSA_ROOT_PEM, tsaSetup } from "@/server/seal/tsa-config";
import type { OrgIntegrityIssue } from "@/server/services/chain-verification";
import { raiseOperationalAlert } from "./alerts";

export type AnchorIntegrityIssue =
  | IntegrityIssue
  | { kind: "anchorToken"; seq: number; reason: string }
  | { kind: "anchorTrust"; seq: number };

/** Racines de confiance du prestataire qui a émis un jeton, par son nom enregistré sur l'ancre. */
function trustFor(tsaName: string) {
  if (tsaName === FREETSA.name) return certificatesFromPem(FREETSA_ROOT_PEM);
  try {
    const setup = tsaSetup();
    return setup.config.name === tsaName ? setup.trustAnchors : null;
  } catch {
    return null;
  }
}

export async function verifyAnchors(tx: Prisma.TransactionClient) {
  const anchors = await tx.anchor.findMany({ orderBy: { seq: "asc" } });
  const issues: AnchorIntegrityIssue[] = [...anchorIssues(anchors)];
  for (const anchor of anchors) {
    const trust = trustFor(anchor.tsaName);
    if (!trust) {
      issues.push({ kind: "anchorTrust", seq: anchor.seq });
      continue;
    }
    try {
      const verified = await verifyTimestamp(anchor.tsaToken, anchor.anchorHash, trust);
      if (verified.genTime.getTime() !== anchor.tsaGenTime.getTime()) {
        issues.push({ kind: "anchorToken", seq: anchor.seq, reason: "genTime" });
      }
    } catch (error) {
      issues.push({
        kind: "anchorToken",
        seq: anchor.seq,
        reason: error instanceof TsaError ? error.code : "error",
      });
    }
  }
  return { anchors: anchors.length, issues };
}

export function reportIntegrity(
  scope: string,
  issues: readonly (OrgIntegrityIssue | AnchorIntegrityIssue)[],
) {
  if (issues.length === 0) return;
  raiseOperationalAlert("seal.integrityFailure", {
    scope,
    count: issues.length,
    // 20 premiers constats : type et numéro de lot, d'ancre ou identifiant de preuve.
    issues: issues
      .slice(0, 20)
      .map((i) => `${i.kind}:${"seq" in i ? i.seq : i.evidenceId}`)
      .join(","),
  });
}
