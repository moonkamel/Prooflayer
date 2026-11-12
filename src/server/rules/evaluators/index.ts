// Registre des évaluateurs livrés (PL-401, PL-402). Chaque clé de `EVALUATOR_KEYS` y entre avec le ticket qui la
// livre ; une clé absente ne produit pas d'évaluation et le contrôle garde son statut. AIA-06-02
// (`internal.exemptionDossier`, ./exemption-dossier.ts) est évalué à chaque signature de classification ou de dossier
// (PL-205), à partir des faits de ProofLayer : il n'est pas réévalué par le moteur, pour n'avoir qu'une source.
import type { EvaluatorKey } from "../evaluator-keys";
import type { EvaluatorRegistry } from "../engine";
import { changeManagementFilesEvaluator } from "./github-change-management";
import { branchProtectionEvaluator, requiredChecksEvaluator } from "./github-branch-protection";
import { peerReviewEvaluator } from "./github-peer-review";
import {
  evalWorkflowOnReleaseEvaluator,
  regressionTestsOnReleaseEvaluator,
  releaseReferencesDocsEvaluator,
} from "./github-releases";
import { secretScanningEvaluator, vulnerabilityAgeEvaluator } from "./github-security";
import { documentEvaluator } from "./document";
import {
  classificationFreshEvaluator,
  packArchivedEvaluator,
  responsibilitiesNamedEvaluator,
} from "./internal";

export const EVALUATORS: EvaluatorRegistry = {
  "document.presentAndFresh": documentEvaluator,
  // GitHub (PL-402)
  "github.evalWorkflowOnRelease": evalWorkflowOnReleaseEvaluator,
  "github.releaseReferencesDocs": releaseReferencesDocsEvaluator,
  "github.branchProtection": branchProtectionEvaluator,
  "github.peerReview": peerReviewEvaluator,
  "github.requiredChecks": requiredChecksEvaluator,
  "github.regressionTestsOnRelease": regressionTestsOnReleaseEvaluator,
  "github.vulnerabilityAge": vulnerabilityAgeEvaluator,
  "github.secretScanning": secretScanningEvaluator,
  "github.changeManagementFiles": changeManagementFilesEvaluator,
  // Internes (PL-402)
  "internal.classificationFresh": classificationFreshEvaluator,
  "internal.responsibilitiesNamed": responsibilitiesNamedEvaluator,
  "internal.packArchived": packArchivedEvaluator,
};

/** Clés dont l'évaluateur est livré. */
export const implementedEvaluatorKeys = (registry: EvaluatorRegistry = EVALUATORS) =>
  Object.keys(registry) as EvaluatorKey[];
