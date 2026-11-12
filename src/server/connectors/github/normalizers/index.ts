// Normaliseurs GitHub (PL-305, §4.5.3) : (événement ou instantané) → preuves minimisées. Fonctions pures.
// Les webhooks sont aiguillés par leur type d'événement GitHub et leur action ; les instantanés (PL-307) appellent
// directement le normaliseur de leur type.
import type { GitHubEvidence, NormalizerContext } from "./common";
import { normalizePullRequestMerged } from "./pull-request";
import { normalizeReleasePublished } from "./release";
import { normalizeReviewSubmitted } from "./review";
import { normalizeWorkflowRunCompleted } from "./workflow-run";

export { normalizeBranchProtectionSnapshot } from "./branch-protection";
export { normalizeFileSnapshot } from "./file";
export { fromGraphQL as pullRequestFromGraphQL, normalizePullRequestMerged } from "./pull-request";
export { normalizeReleasePublished } from "./release";
export { normalizeReviewSubmitted } from "./review";
export { normalizeSecurityAlertsSnapshot } from "./security-alerts";
export { normalizeWorkflowRunCompleted } from "./workflow-run";
export type { GitHubEvidence, NormalizerContext } from "./common";

const WEBHOOK_NORMALIZERS: Record<string, Record<string, typeof normalizePullRequestMerged>> = {
  pull_request: { closed: normalizePullRequestMerged },
  pull_request_review: { submitted: normalizeReviewSubmitted },
  workflow_run: { completed: normalizeWorkflowRunCompleted },
  release: { published: normalizeReleasePublished },
};

/** Preuves d'un webhook GitHub ; un événement ou une action non suivis n'en donnent aucune. */
export function normalizeWebhook(
  eventType: string,
  payload: unknown,
  ctx: NormalizerContext,
): GitHubEvidence[] {
  const action =
    payload && typeof payload === "object" && "action" in payload
      ? String((payload as { action: unknown }).action)
      : "";
  const normalizer = WEBHOOK_NORMALIZERS[eventType]?.[action];
  return normalizer ? normalizer(payload, ctx) : [];
}
