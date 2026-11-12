// Évaluateurs internes (PL-402), d'après les preuves `system.*` que ProofLayer émet lui-même (signature d'une
// classification, instantané de la fiche du registre, pack d'audit généré). Fonctions pures.
// - AIA-06-01 (`internal.classificationFresh`) : classification signée datant de moins de maxAgeDays jours et
//   postérieure à la dernière modification de la fiche ; une modification d'un champ de classification marque la
//   classification « à revoir » (PL-201), relevé par l'instantané de la fiche.
// - AIA-17-03 (`internal.responsibilitiesNamed`) : responsables nommés pour le système, le contrôle humain et la
//   conformité (signataire de la classification en vigueur).
// - AIA-17-04 (`internal.packArchived`) : un pack d'audit au moins tous les maxIntervalDays jours.
// AIA-06-02 (`internal.exemptionDossier`) : ./exemption-dossier.ts.
import { z } from "zod";
import {
  newestFirst,
  reason,
  type EvaluableControl,
  type EvidenceRecord,
  type EvaluatorEntry,
} from "../engine";
import type { Evaluation, EvaluationReason } from "../evaluation";
import { missing, numberParam, parsed, result, staleness } from "./common";

const DAY_MS = 86_400_000;

export const CLASSIFICATION_SIGNED = "system.classification.signed";
export const REGISTRY_SNAPSHOT = "system.registry.snapshot";
export const PACK_GENERATED = "system.pack.generated";

export const classificationSignedPayload = z.object({
  systemId: z.string(),
  classificationId: z.string(),
  tier: z.string(),
  role: z.string(),
  rulesetVersion: z.string(),
  signedAt: z.string().datetime(),
  signedByUserId: z.string().nullable(),
});
export const registrySnapshotPayload = z.object({
  systemId: z.string(),
  ownerUserId: z.string().nullable(),
  oversightOwnerUserId: z.string().nullable(),
  /** Signataire de la classification en vigueur, responsable de la conformité du système. */
  complianceSignerUserId: z.string().nullable(),
  classificationStale: z.boolean(),
  archived: z.boolean(),
  updatedAt: z.string().datetime(),
});
export const packGeneratedPayload = z.object({
  systemId: z.string(),
  packId: z.string(),
  generatedAt: z.string().datetime(),
});

export function evaluateClassificationFresh(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const maxAgeDays = numberParam(control, "maxAgeDays", 365);
  const [signed] = newestFirst(
    parsed(evidence, CLASSIFICATION_SIGNED, classificationSignedPayload).map((c) => c.record),
  );
  if (!signed) {
    return missing(
      "NO_SIGNED_CLASSIFICATION",
      "Le système n'a pas de classification signée.",
      "The system has no signed classification.",
    );
  }
  const [snapshot] = newestFirst(
    parsed(evidence, REGISTRY_SNAPSHOT, registrySnapshotPayload)
      .filter((s) => s.record.occurredAt >= signed.occurredAt)
      .map((s) => s.record),
  );
  const snapshotData = snapshot ? registrySnapshotPayload.parse(snapshot.payload) : null;
  if (snapshotData?.classificationStale) {
    return result(
      "FAIL",
      [
        reason(
          "CLASSIFICATION_TO_REVIEW",
          "La fiche a été modifiée après la signature : la classification est à revoir.",
          "The record was modified after signature: the classification must be reviewed.",
          [signed.id, snapshot!.id],
        ),
      ],
      [signed.id, snapshot!.id],
    );
  }
  const ageDays = Math.floor((now.getTime() - signed.occurredAt.getTime()) / DAY_MS);
  const stale = staleness(control, [signed], now);
  if (stale || ageDays > maxAgeDays) {
    return result(
      "STALE",
      [
        reason(
          "CLASSIFICATION_TOO_OLD",
          `La classification signée date de ${ageDays} jours (au plus ${maxAgeDays}).`,
          `The signed classification is ${ageDays} days old (at most ${maxAgeDays}).`,
          [signed.id],
        ),
      ],
      [signed.id],
    );
  }
  const ids = snapshot ? [signed.id, snapshot.id] : [signed.id];
  return result(
    "PASS",
    [
      reason(
        "CLASSIFICATION_CURRENT",
        `Classification signée il y a ${ageDays} jours, postérieure à la dernière modification de la fiche.`,
        `Classification signed ${ageDays} days ago, after the last change to the record.`,
        ids,
      ),
    ],
    ids,
  );
}

export function evaluateResponsibilitiesNamed(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const [latest] = newestFirst(
    parsed(evidence, REGISTRY_SNAPSHOT, registrySnapshotPayload).map((s) => s.record),
  );
  if (!latest) {
    return missing(
      "NO_REGISTRY_SNAPSHOT",
      "Aucun instantané de la fiche du système.",
      "No snapshot of the system record.",
    );
  }
  const stale = staleness(control, [latest], now);
  if (stale) return stale;
  const data = registrySnapshotPayload.parse(latest.payload);
  const roles: [keyof typeof data, string, string, string][] = [
    ["ownerUserId", "NO_SYSTEM_OWNER", "responsable du système", "system owner"],
    [
      "oversightOwnerUserId",
      "NO_OVERSIGHT_OWNER",
      "responsable du contrôle humain",
      "human oversight owner",
    ],
    [
      "complianceSignerUserId",
      "NO_COMPLIANCE_OWNER",
      "responsable de la conformité (signataire de la classification)",
      "compliance owner (classification signatory)",
    ],
  ];
  const absent: EvaluationReason[] = roles
    .filter(([field]) => !data[field])
    .map(([, code, fr, en]) => reason(code, `Aucun ${fr} nommé.`, `No ${en} named.`, [latest.id]));
  if (absent.length === 0) {
    return result(
      "PASS",
      [
        reason(
          "RESPONSIBILITIES_NAMED",
          "Responsables nommés : système, contrôle humain, conformité.",
          "Named owners: system, human oversight, compliance.",
          [latest.id],
        ),
      ],
      [latest.id],
    );
  }
  return result(absent.length === roles.length ? "FAIL" : "PARTIAL", absent, [latest.id]);
}

export function evaluatePackArchived(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const maxIntervalDays = numberParam(control, "maxIntervalDays", 183);
  const packs = newestFirst(
    parsed(evidence, PACK_GENERATED, packGeneratedPayload).map((p) => p.record),
  );
  if (packs.length === 0) {
    return missing("NO_PACK", "Aucun pack d'audit généré.", "No audit pack generated.");
  }
  const latest = packs[0]!;
  const age = Math.floor((now.getTime() - latest.occurredAt.getTime()) / DAY_MS);
  if (staleness(control, [latest], now) || age > maxIntervalDays) {
    return result(
      "STALE",
      [
        reason(
          "PACK_TOO_OLD",
          `Le dernier pack d'audit date de ${age} jours (au plus ${maxIntervalDays}).`,
          `The latest audit pack is ${age} days old (at most ${maxIntervalDays}).`,
          [latest.id],
        ),
      ],
      [latest.id],
    );
  }
  // Sur les douze derniers mois, deux packs consécutifs ne doivent pas être séparés de plus de maxIntervalDays jours.
  const yearAgo = now.getTime() - 365 * DAY_MS;
  for (let i = 0; i + 1 < packs.length; i++) {
    const newer = packs[i]!;
    const older = packs[i + 1]!;
    if (newer.occurredAt.getTime() < yearAgo) break;
    // Seule la part de l'intervalle comprise dans les douze derniers mois compte.
    const from = Math.max(older.occurredAt.getTime(), yearAgo);
    const gap = Math.floor((newer.occurredAt.getTime() - from) / DAY_MS);
    if (gap > maxIntervalDays) {
      return result(
        "FAIL",
        [
          reason(
            "PACK_GAP",
            `${gap} jours sans pack d'audit au cours des douze derniers mois (au plus ${maxIntervalDays}).`,
            `${gap} days without an audit pack in the last twelve months (at most ${maxIntervalDays}).`,
            [older.id, newer.id],
          ),
        ],
        [older.id, newer.id],
      );
    }
  }
  return result(
    "PASS",
    [
      reason(
        "PACK_ARCHIVED",
        `Dernier pack d'audit généré il y a ${age} jours.`,
        `Latest audit pack generated ${age} days ago.`,
        [latest.id],
      ),
    ],
    [latest.id],
  );
}

export const classificationFreshEvaluator: EvaluatorEntry = {
  version: "internal.classificationFresh@1",
  evaluate: evaluateClassificationFresh,
};
export const responsibilitiesNamedEvaluator: EvaluatorEntry = {
  version: "internal.responsibilitiesNamed@1",
  evaluate: evaluateResponsibilitiesNamed,
};
export const packArchivedEvaluator: EvaluatorEntry = {
  version: "internal.packArchived@1",
  evaluate: evaluatePackArchived,
};
