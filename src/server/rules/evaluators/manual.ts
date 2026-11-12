// Évaluateur des contrôles manuels, clé `manual.evidencePresent` (PL-405, §3.2 E5) : une preuve déposée ou une
// attestation rattachée au contrôle par un utilisateur, en cours de validité. Toujours déclarative : la raison le dit.
// Validité expirée (ou durée de fraîcheur du contrôle dépassée) → STALE. Fonction pure.
import {
  isStale,
  newestFirst,
  reason,
  type EvaluableControl,
  type EvidenceRecord,
  type EvaluatorEntry,
} from "../engine";
import type { Evaluation } from "../evaluation";
import { missing, result } from "./common";

export function evaluateManualEvidence(
  control: EvaluableControl,
  evidence: readonly EvidenceRecord[],
  now: Date,
): Evaluation {
  const linked = newestFirst(evidence.filter((e) => e.linkedByUser));
  if (linked.length === 0) {
    return missing(
      "NO_DECLARATIVE_EVIDENCE",
      "Aucune preuve déposée ni attestation pour ce contrôle.",
      "No uploaded evidence or attestation for this control.",
    );
  }
  const valid = linked.filter((e) => !isStale(e, control.freshnessDays, now));
  if (valid.length === 0) {
    return result(
      "STALE",
      [
        reason(
          "DECLARATIVE_EVIDENCE_EXPIRED",
          "La preuve déclarative a dépassé sa date de validité.",
          "The declarative evidence is past its validity date.",
          linked.map((e) => e.id),
        ),
      ],
      linked.map((e) => e.id),
    );
  }
  const until = valid
    .map((e) => e.validUntil)
    .filter((d): d is Date => d !== null)
    .sort((a, b) => b.getTime() - a.getTime())[0];
  const date = until?.toISOString().slice(0, 10);
  return result(
    "PASS",
    [
      reason(
        "DECLARATIVE_EVIDENCE_PRESENT",
        date
          ? `Preuve déclarative présente, valable jusqu'au ${date} ; son contenu reste apprécié par un humain.`
          : "Preuve déclarative présente ; son contenu reste apprécié par un humain.",
        date
          ? `Declarative evidence present, valid until ${date}; its content is assessed by a person.`
          : "Declarative evidence present; its content is assessed by a person.",
        valid.map((e) => e.id),
      ),
    ],
    valid.map((e) => e.id),
  );
}

export const manualEvidenceEvaluator: EvaluatorEntry = {
  version: "manual.evidencePresent@1",
  evaluate: evaluateManualEvidence,
};
