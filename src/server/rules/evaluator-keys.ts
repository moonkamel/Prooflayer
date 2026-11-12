// Clés des évaluateurs (§3.2 E6, §4.3.2 `ControlDefinition.evaluatorKey`). La bibliothèque de contrôles (PL-206)
// ne référence que des clés déclarées ici ; chaque clé nomme le ticket qui livre la fonction d'évaluation pure
// `(contrôle, preuves, date) → { statut, raisons }`. La clé "github.peerReview" est fixée par le prompt-type de PL-402.
export const EVALUATOR_KEYS = {
  // Évaluateurs internes (PL-402)
  "internal.classificationFresh": "PL-402",
  "internal.exemptionDossier": "PL-402",
  "internal.responsibilitiesNamed": "PL-402",
  "internal.packArchived": "PL-402",
  // Évaluateurs GitHub (PL-402)
  "github.evalWorkflowOnRelease": "PL-402",
  "github.releaseReferencesDocs": "PL-402",
  "github.branchProtection": "PL-402",
  "github.peerReview": "PL-402",
  "github.requiredChecks": "PL-402",
  "github.regressionTestsOnRelease": "PL-402",
  "github.vulnerabilityAge": "PL-402",
  "github.secretScanning": "PL-402",
  "github.changeManagementFiles": "PL-402",
  // Évaluateurs Jira (PL-404)
  "jira.riskRegisterExists": "PL-404",
  "jira.riskRegisterReviewed": "PL-404",
  "jira.riskMitigationLinked": "PL-404",
  "jira.incidentCorrectiveAction": "PL-404",
  "jira.monitoringReviewed": "PL-404",
  "jira.seriousIncidentNotified": "PL-404",
  // Contrôles semi-automatiques : présence et fraîcheur d'un fichier ou d'un document (PL-401)
  "document.presentAndFresh": "PL-401",
  // Contrôles manuels : preuve déposée ou attestation en cours de validité (PL-405)
  "manual.evidencePresent": "PL-405",
} as const;

export type EvaluatorKey = keyof typeof EVALUATOR_KEYS;
export const isEvaluatorKey = (key: string): key is EvaluatorKey => key in EVALUATOR_KEYS;
