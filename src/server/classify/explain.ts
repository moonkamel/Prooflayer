// Explication d'une classification (PL-204, §5.3 écran A) : lignes de la trace de raisonnement, rattachées à la
// question et à l'article, et implications (date d'application, mode d'évaluation). Fonctions pures.
import type { AnswerKey } from "./answers";
import type { ClassifiedTier, ReasoningStep } from "./engine";
import type { QuestionId } from "./questionnaire";

const QUESTION_OF: Record<AnswerKey, QuestionId> = {
  isAiSystem: "aiSystem",
  inScope: "scope",
  prohibitedPractices: "prohibited",
  annexISafetyComponent: "annexI",
  annexIIIPoints: "annexIII",
  performsProfiling: "profiling",
  art63Conditions: "art63",
  interactsWithPersons: "transparency",
  generatesSyntheticContent: "transparency",
  developsSystem: "developer",
  ownBrand: "art25",
  substantialModification: "art25",
  changedPurpose: "art25",
};

export interface TraceLine {
  /** Clé du libellé : `<règle>.continue`, `<règle>.concludes`, ou `noAnnexIII`. */
  key: string;
  ruleId: string;
  articleRef: string;
  /** Question dont la réponse a décidé la ligne ; null pour une règle par défaut (R9, ROLE5). */
  questionId: QuestionId | null;
  concludes: boolean;
}

/**
 * Lignes affichées, dans l'ordre d'évaluation. Quand aucun point de l'Annexe III n'est déclaré, R5 à R7 ne
 * concluent pas pour la même raison : une seule ligne « aucun cas d'usage de l'Annexe III » les remplace.
 */
export function traceLines(reasoning: readonly ReasoningStep[]): TraceLine[] {
  const lines: TraceLine[] = [];
  for (const step of reasoning) {
    const concludes = step.outcome !== "CONTINUE";
    const questionId = step.answerKey ? QUESTION_OF[step.answerKey] : null;
    if (!concludes && step.answerKey === "annexIIIPoints") {
      if (step.ruleId === "R5") {
        lines.push({
          key: "noAnnexIII",
          ruleId: "R5",
          articleRef: "Art. 6(2), Annexe III",
          questionId,
          concludes,
        });
      }
      continue;
    }
    lines.push({
      key: `${step.ruleId}.${concludes ? "concludes" : "continue"}`,
      ruleId: step.ruleId,
      articleRef: step.articleRef,
      questionId,
      concludes,
    });
  }
  return lines;
}

export interface Implications {
  /** Date d'application des obligations (AAAA-MM-JJ), d'après le §1.5 du cahier des charges ; null : aucune. */
  applicationDate: string | null;
  applicationRef: string | null;
  /** Mode d'évaluation de conformité (Art. 43) pour un système à haut risque. */
  assessment: "internalControl" | "notifiedBodyPossible" | "sectoral" | null;
  assessmentRef: string | null;
}

/** Implications de la catégorie : dates du §1.5 (Art. 113 modifié par le règlement 2026/1744, Art. 50, Art. 5). */
export function implicationsOf(
  tier: ClassifiedTier,
  annexIIIPoints: readonly string[],
): Implications {
  const none = {
    applicationDate: null,
    applicationRef: null,
    assessment: null,
    assessmentRef: null,
  };
  switch (tier) {
    case "HIGH_RISK":
      if (annexIIIPoints.length === 0) {
        return {
          applicationDate: "2028-08-02",
          applicationRef: "Art. 113",
          assessment: "sectoral",
          assessmentRef: "Art. 43(3)",
        };
      }
      return {
        applicationDate: "2027-12-02",
        applicationRef: "Art. 113",
        ...(annexIIIPoints.some((p) => p.startsWith("1("))
          ? { assessment: "notifiedBodyPossible" as const, assessmentRef: "Art. 43(1)" }
          : { assessment: "internalControl" as const, assessmentRef: "Art. 43(2), Annexe VI" }),
      };
    case "HIGH_RISK_EXEMPT_ART6_3":
      return { ...none, applicationDate: "2027-12-02", applicationRef: "Art. 6(4), Art. 49(2)" };
    case "LIMITED_TRANSPARENCY":
      return { ...none, applicationDate: "2026-08-02", applicationRef: "Art. 50" };
    case "PROHIBITED":
      return { ...none, applicationDate: "2025-02-02", applicationRef: "Art. 5" };
    default:
      return none;
  }
}
