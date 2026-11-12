// Normaliseur `github.branch_protection.snapshot` : instantané de la protection de la branche par défaut (API REST
// `GET /repos/{owner}/{repo}/branches/{branch}/protection` ; null pour une branche non protégée). Sert à AIA-15-01 et
// AIA-15-03. Une preuve par jour et par état (PL-307). Liste blanche : ni utilisateurs ni équipes autorisés.
import { z } from "zod";
import { contentSha256 } from "@/server/seal/evidence";
import {
  dayOf,
  parse,
  repositorySchema,
  type GitHubEvidence,
  type NormalizerContext,
} from "./common";

export const BRANCH_PROTECTION_SNAPSHOT = "github.branch_protection.snapshot";

const enabled = z.object({ enabled: z.boolean() }).nullable().optional();

const schema = z.object({
  repository: repositorySchema,
  branch: z.string().min(1),
  takenAt: z.string().datetime(),
  protection: z
    .object({
      required_status_checks: z
        .object({
          strict: z.boolean(),
          contexts: z.array(z.string()).optional().default([]),
          checks: z.array(z.object({ context: z.string() })).optional(),
        })
        .nullable()
        .optional(),
      required_pull_request_reviews: z
        .object({
          required_approving_review_count: z.number().int().nonnegative().optional().default(0),
          dismiss_stale_reviews: z.boolean().optional().default(false),
          require_code_owner_reviews: z.boolean().optional().default(false),
        })
        .nullable()
        .optional(),
      enforce_admins: enabled,
      required_linear_history: enabled,
      allow_force_pushes: enabled,
      allow_deletions: enabled,
    })
    .nullable(),
});

export function normalizeBranchProtectionSnapshot(
  payload: unknown,
  ctx: NormalizerContext,
): GitHubEvidence[] {
  const snapshot = parse(schema, payload, BRANCH_PROTECTION_SNAPSHOT, ctx);
  if (!snapshot) return [];
  const p = snapshot.protection;
  const checks = p?.required_status_checks;
  const reviews = p?.required_pull_request_reviews;
  const state = {
    branch: snapshot.branch,
    defaultBranch: snapshot.branch === snapshot.repository.default_branch,
    protected: p !== null,
    requiredApprovingReviewCount: reviews?.required_approving_review_count ?? 0,
    dismissStaleReviews: reviews?.dismiss_stale_reviews ?? false,
    requireCodeOwnerReviews: reviews?.require_code_owner_reviews ?? false,
    requiredStatusChecks: [
      ...new Set([...(checks?.contexts ?? []), ...(checks?.checks ?? []).map((c) => c.context)]),
    ].sort(),
    strictStatusChecks: checks?.strict ?? false,
    enforceAdmins: p?.enforce_admins?.enabled ?? false,
    requireLinearHistory: p?.required_linear_history?.enabled ?? false,
    allowForcePushes: p?.allow_force_pushes?.enabled ?? false,
    allowDeletions: p?.allow_deletions?.enabled ?? false,
  };
  const fingerprint = contentSha256(state).toString("hex").slice(0, 16);
  const repo = snapshot.repository;
  return [
    {
      kind: BRANCH_PROTECTION_SNAPSHOT,
      source: "GITHUB",
      capturedVia: ctx.capturedVia,
      resourceId: ctx.resourceId,
      sourceRef: `${repo.id}/branch/${snapshot.branch}`,
      sourceUrl: `https://github.com/${repo.full_name}/settings/branches`,
      dedupeKey: `gh:bp:${repo.id}:${snapshot.branch}:${dayOf(snapshot.takenAt)}:${fingerprint}`,
      occurredAt: new Date(snapshot.takenAt),
      summary: state.protected
        ? `Protection de ${snapshot.branch} : ${state.requiredApprovingReviewCount} approbation(s) requise(s)`
        : `Branche ${snapshot.branch} non protégée`,
      actor: null,
      payload: { ...state, takenAt: new Date(snapshot.takenAt).toISOString() },
    },
  ];
}
