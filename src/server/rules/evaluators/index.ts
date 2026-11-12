// Registre des évaluateurs livrés (PL-401). Chaque clé de `EVALUATOR_KEYS` y entre avec le ticket qui la livre ;
// une clé absente ne produit pas d'évaluation et le contrôle garde son statut. AIA-06-02 (`internal.exemptionDossier`)
// est encore évalué à la signature (PL-205), à partir des faits de ProofLayer : il rejoint ce registre avec PL-402.
import type { EvaluatorKey } from "../evaluator-keys";
import type { EvaluatorRegistry } from "../engine";
import { documentEvaluator } from "./document";

export const EVALUATORS: EvaluatorRegistry = {
  "document.presentAndFresh": documentEvaluator,
};

/** Clés dont l'évaluateur est livré. */
export const implementedEvaluatorKeys = (registry: EvaluatorRegistry = EVALUATORS) =>
  Object.keys(registry) as EvaluatorKey[];
