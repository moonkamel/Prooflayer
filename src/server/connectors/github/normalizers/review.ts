// Normaliseur `github.review.submitted` : webhook `pull_request_review` (action « submitted »). Sert à AIA-15-02
// (approbation par un relecteur distinct de l'auteur). Liste blanche : ni corps ni commentaires.
import { z } from "zod";
import {
  loginOf,
  parse,
  repositorySchema,
  type GitHubEvidence,
  type NormalizerContext,
} from "./common";

export const REVIEW_SUBMITTED = "github.review.submitted";

const schema = z.object({
  action: z.literal("submitted"),
  review: z.object({
    id: z.number().int().positive(),
    state: z.string(),
    submitted_at: z.string().datetime(),
    commit_id: z.string().nullable(),
    html_url: z.string().url(),
    user: z.object({ login: z.string() }).nullable(),
  }),
  pull_request: z.object({
    number: z.number().int().positive(),
    user: z.object({ login: z.string() }).nullable(),
  }),
  repository: repositorySchema,
});

export function normalizeReviewSubmitted(
  payload: unknown,
  ctx: NormalizerContext,
): GitHubEvidence[] {
  const event = parse(schema, payload, REVIEW_SUBMITTED, ctx);
  if (!event) return [];
  const { review, pull_request: pr, repository } = event;
  const reviewer = loginOf(review.user);
  return [
    {
      kind: REVIEW_SUBMITTED,
      source: "GITHUB",
      capturedVia: ctx.capturedVia,
      resourceId: ctx.resourceId,
      sourceRef: `${repository.id}#${pr.number}/review/${review.id}`,
      sourceUrl: review.html_url,
      dedupeKey: `gh:review:${repository.id}:${review.id}`,
      occurredAt: new Date(review.submitted_at),
      summary: `Revue ${review.state.toUpperCase()} sur la PR #${pr.number}`,
      actor: reviewer ? { login: reviewer } : null,
      payload: {
        pullNumber: pr.number,
        reviewId: review.id,
        // Le webhook écrit l'état en minuscules, GraphQL en majuscules : une seule forme stockée.
        state: review.state.toUpperCase(),
        reviewer,
        pullAuthor: loginOf(pr.user),
        commitId: review.commit_id,
        submittedAt: new Date(review.submitted_at).toISOString(),
      },
    },
  ];
}
