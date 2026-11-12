// Évaluateur interne du contrôle AIA-06-02 (Art. 6(3), 6(4)), clé `internal.exemptionDossier`. Fonction pure :
// « en cas d'exemption : évaluation documentée avant mise sur le marché, condition retenue justifiée, absence de
// profilage motivée » (§12.3). Les faits viennent de ProofLayer (classification signée, dossier signé) ; ils
// deviendront des preuves `system.*` avec le magasin de preuves (PL-304).
import type { RiskTier } from "@/generated/prisma/enums";
import type { Evaluation } from "../evaluation";

export const EXEMPTION_DOSSIER_EVALUATOR_VERSION = "internal.exemptionDossier@2";

export interface ExemptionFacts {
  /** Catégorie de la classification signée en vigueur ; null si aucune. */
  tier: RiskTier | null;
  /** Classification signée en vigueur. */
  classificationId: string | null;
  /** Dossier signé rattaché à cette classification. */
  dossier: {
    id: string;
    signedAt: Date;
    conditionJustification: string;
    profilingJustification: string;
  } | null;
  /** Date de mise sur le marché ou en service déclarée sur la fiche. */
  placedOnMarketAt: Date | null;
  /** Dossier signé pour une classification antérieure, remplacée depuis (PL-402). */
  previousDossierId?: string | null;
}

const reason = (code: string, fr: string, en: string, evidenceIds: string[] = []) => ({
  code,
  message: { fr, en },
  evidenceIds,
});

export function evaluateExemptionDossier(facts: ExemptionFacts, now: Date): Evaluation {
  if (facts.tier !== "HIGH_RISK_EXEMPT_ART6_3") {
    return {
      status: "NOT_APPLICABLE",
      reasons: [
        reason(
          "NOT_EXEMPT",
          "Le système n'est pas classé exempté au titre de l'Art. 6(3).",
          "The system is not classified as exempted under Art. 6(3).",
        ),
      ],
      evidenceIds: [],
    };
  }
  const ids = facts.classificationId ? [facts.classificationId] : [];
  const dossier = facts.dossier;
  if (!dossier && facts.previousDossierId) {
    // Le dossier signé justifiait une classification remplacée depuis : il est périmé.
    return {
      status: "STALE",
      reasons: [
        reason(
          "DOSSIER_FOR_SUPERSEDED_CLASSIFICATION",
          "Le dossier signé porte sur une classification remplacée ; la classification en vigueur n'a pas de dossier.",
          "The signed file relates to a superseded classification; the classification in force has no file.",
          [...ids, facts.previousDossierId],
        ),
      ],
      evidenceIds: [...ids, facts.previousDossierId],
    };
  }
  if (!dossier) {
    return {
      status: "MISSING",
      reasons: [
        reason(
          "NO_SIGNED_DOSSIER",
          "Aucun dossier d'exemption signé pour la classification en vigueur.",
          "No signed exemption file for the classification in force.",
          ids,
        ),
      ],
      evidenceIds: ids,
    };
  }
  const evidence = [...ids, dossier.id];
  if (!dossier.conditionJustification.trim() || !dossier.profilingJustification.trim()) {
    return {
      status: "FAIL",
      reasons: [
        reason(
          "INCOMPLETE_DOSSIER",
          "Le dossier ne justifie pas la condition retenue ou l'absence de profilage.",
          "The file does not justify the condition relied on or the absence of profiling.",
          [dossier.id],
        ),
      ],
      evidenceIds: evidence,
    };
  }
  if (facts.placedOnMarketAt && facts.placedOnMarketAt < dossier.signedAt) {
    return {
      status: "PARTIAL",
      reasons: [
        reason(
          "ASSESSED_AFTER_MARKET",
          "Le dossier a été signé après la mise sur le marché ou en service déclarée ; l'Art. 6(4) demande une évaluation documentée avant.",
          "The file was signed after the declared placing on the market or putting into service; Art. 6(4) requires the assessment to be documented before.",
          [dossier.id],
        ),
      ],
      evidenceIds: evidence,
    };
  }
  void now;
  return {
    status: "PASS",
    reasons: [
      reason(
        "SIGNED_DOSSIER",
        "Dossier d'exemption signé : condition retenue justifiée, absence de profilage motivée.",
        "Signed exemption file: condition relied on justified, absence of profiling reasoned.",
        [dossier.id],
      ),
    ],
    evidenceIds: evidence,
  };
}
