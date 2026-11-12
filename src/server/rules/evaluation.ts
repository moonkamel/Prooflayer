// Résultat d'un évaluateur (§3.2 E6, prompt-type de PL-402) : statut parmi les six, raisons structurées bilingues.
import type { ControlStatus } from "@/generated/prisma/enums";

export interface EvaluationReason {
  code: string;
  message: { fr: string; en: string };
  evidenceIds: string[];
}

export interface Evaluation {
  status: ControlStatus;
  reasons: EvaluationReason[];
  evidenceIds: string[];
}
