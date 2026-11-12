// Preuves émises par ProofLayer lui-même (PL-402, `system.*` de EVIDENCE_KINDS) : signature d'une classification,
// instantané de la fiche du registre. Elles alimentent les évaluateurs internes (AIA-06-01, AIA-17-03) et entrent au
// magasin de preuves comme les autres (empreinte, scellement). Charges minimisées : identifiants, catégories, dates.
// Chaque fonction s'exécute dans une transaction où app.org_id est positionné, et programme les contrôles concernés.
import type { OrgTransaction } from "@/server/db";
import { contentSha256 } from "@/server/seal/evidence";
import { scheduleEvaluation } from "@/server/system/jobs/control-evaluate";
import { CLASSIFICATION_SIGNED, REGISTRY_SNAPSHOT } from "@/server/rules/evaluators/internal";
import { createEvidence } from "./evidence";
import { scheduleEvaluations } from "./evaluation";

/** Preuve de la signature d'une classification. */
export async function recordClassificationSigned(
  tx: OrgTransaction,
  orgId: string,
  classificationId: string,
) {
  const c = await tx.classification.findUniqueOrThrow({ where: { id: classificationId } });
  if (c.status !== "SIGNED" || !c.signedAt) return null;
  const result = await createEvidence(tx, orgId, {
    kind: CLASSIFICATION_SIGNED,
    source: "SYSTEM",
    capturedVia: "API",
    sourceRef: `system:${c.systemId}:classification:${c.id}`,
    dedupeKey: `sys:classification:${c.id}:signed`,
    occurredAt: c.signedAt,
    summary: `Classification signée (${c.tier})`,
    payload: {
      systemId: c.systemId,
      classificationId: c.id,
      tier: c.tier,
      role: c.role,
      rulesetVersion: c.rulesetVersion,
      signedAt: c.signedAt.toISOString(),
      signedByUserId: c.signedByUserId,
    },
  });
  if (result.created) {
    await scheduleEvaluations(
      tx,
      orgId,
      [{ id: result.id, kind: CLASSIFICATION_SIGNED, resourceId: null, systemId: c.systemId }],
      scheduleEvaluation,
    );
  }
  return result;
}

/** Instantané de la fiche du système : responsables, classification « à revoir », archivage. Une preuve par état. */
export async function recordRegistrySnapshot(
  tx: OrgTransaction,
  orgId: string,
  systemId: string,
  now: Date = new Date(),
) {
  const system = await tx.aiSystem.findUniqueOrThrow({ where: { id: systemId } });
  const signed = await tx.classification.findFirst({
    where: { systemId, status: "SIGNED" },
    orderBy: { signedAt: "desc" },
    select: { signedByUserId: true },
  });
  const state = {
    systemId,
    ownerUserId: system.ownerUserId || null,
    oversightOwnerUserId: system.oversightOwnerUserId,
    complianceSignerUserId: signed?.signedByUserId ?? null,
    classificationStale: system.classificationStale,
    archived: system.archivedAt !== null,
    updatedAt: system.updatedAt.toISOString(),
  };
  const fingerprint = contentSha256(state).toString("hex").slice(0, 16);
  const result = await createEvidence(tx, orgId, {
    kind: REGISTRY_SNAPSHOT,
    source: "SYSTEM",
    capturedVia: "SNAPSHOT",
    sourceRef: `system:${systemId}:registry`,
    dedupeKey: `sys:registry:${systemId}:${fingerprint}`,
    occurredAt: now,
    summary: "Instantané de la fiche du système",
    payload: state,
  });
  if (result.created) {
    await scheduleEvaluations(
      tx,
      orgId,
      [{ id: result.id, kind: REGISTRY_SNAPSHOT, resourceId: null, systemId }],
      scheduleEvaluation,
    );
  }
  return result;
}
