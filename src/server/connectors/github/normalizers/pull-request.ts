// Normaliseur `github.pull_request.merged` (prompt-type de PL-305). Webhook `pull_request` (action « closed »,
// merged = true) et rattrapage GraphQL (`fromGraphQL`) donnent la même preuve : même dedupeKey, même payload.
// Liste blanche stricte : ni corps, ni diff, ni commentaires, ni adresses email.
import { z } from "zod";
import {
  loginOf,
  parse,
  repositorySchema,
  type GitHubEvidence,
  type NormalizerContext,
} from "./common";

export const PULL_REQUEST_MERGED = "github.pull_request.merged";

const userSchema = z.object({ login: z.string() }).nullable();

const webhookSchema = z.object({
  action: z.literal("closed"),
  pull_request: z.object({
    number: z.number().int().positive(),
    title: z.string(),
    html_url: z.string().url(),
    merged: z.boolean(),
    merged_at: z.string().datetime().nullable(),
    merge_commit_sha: z.string().nullable(),
    draft: z.boolean().optional().default(false),
    changed_files: z.number().int().nonnegative(),
    user: userSchema,
    merged_by: userSchema.optional(),
    labels: z.array(z.object({ name: z.string() })),
    base: z.object({ ref: z.string() }),
    head: z.object({ sha: z.string() }),
  }),
  repository: repositorySchema,
});

/** Forme commune aux deux entrées, avant liste blanche. */
interface MergedPullRequest {
  repositoryId: number;
  defaultBranch: string;
  number: number;
  title: string;
  url: string;
  baseRef: string;
  headSha: string;
  mergeCommitSha: string | null;
  mergedAt: string;
  author: string | null;
  mergedBy: string | null;
  changedFiles: number;
  labels: string[];
  draft: boolean;
}

function toEvidence(pr: MergedPullRequest, ctx: NormalizerContext): GitHubEvidence[] {
  if (pr.baseRef !== pr.defaultBranch) return [];
  return [
    {
      kind: PULL_REQUEST_MERGED,
      source: "GITHUB",
      capturedVia: ctx.capturedVia,
      resourceId: ctx.resourceId,
      sourceRef: `${pr.repositoryId}#${pr.number}`,
      sourceUrl: pr.url,
      dedupeKey: `gh:pr:${pr.repositoryId}:${pr.number}:merged`,
      occurredAt: new Date(pr.mergedAt),
      summary: `PR #${pr.number} fusionnée dans ${pr.baseRef}`,
      actor: pr.author ? { login: pr.author } : null,
      payload: {
        number: pr.number,
        title: pr.title,
        baseRef: pr.baseRef,
        headSha: pr.headSha,
        mergeCommitSha: pr.mergeCommitSha,
        mergedAt: new Date(pr.mergedAt).toISOString(),
        author: pr.author,
        mergedBy: pr.mergedBy,
        changedFiles: pr.changedFiles,
        labels: [...pr.labels].sort(),
        draft: pr.draft,
      },
    },
  ];
}

export function normalizePullRequestMerged(
  payload: unknown,
  ctx: NormalizerContext,
): GitHubEvidence[] {
  const event = parse(webhookSchema, payload, PULL_REQUEST_MERGED, ctx);
  const mergedAt = event?.pull_request.merged_at;
  if (!event || !event.pull_request.merged || !mergedAt) return [];
  const pr = event.pull_request;
  return toEvidence(
    {
      repositoryId: event.repository.id,
      defaultBranch: event.repository.default_branch,
      number: pr.number,
      title: pr.title,
      url: pr.html_url,
      baseRef: pr.base.ref,
      headSha: pr.head.sha,
      mergeCommitSha: pr.merge_commit_sha,
      mergedAt,
      author: loginOf(pr.user),
      mergedBy: loginOf(pr.merged_by),
      changedFiles: pr.changed_files,
      labels: pr.labels.map((l) => l.name),
      draft: pr.draft,
    },
    ctx,
  );
}

/** Nœud `PullRequest` de la requête GraphQL de rattrapage (PL-306). */
const graphQLSchema = z.object({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  merged: z.boolean(),
  mergedAt: z.string().datetime().nullable(),
  mergeCommit: z.object({ oid: z.string() }).nullable(),
  headRefOid: z.string(),
  baseRefName: z.string(),
  isDraft: z.boolean(),
  changedFiles: z.number().int().nonnegative(),
  author: z.object({ login: z.string() }).nullable(),
  mergedBy: z.object({ login: z.string() }).nullable(),
  labels: z.object({ nodes: z.array(z.object({ name: z.string() })) }),
  repository: z.object({
    databaseId: z.number().int().positive(),
    defaultBranchRef: z.object({ name: z.string() }),
  }),
});

export function fromGraphQL(node: unknown, ctx: NormalizerContext): GitHubEvidence[] {
  const pr = parse(graphQLSchema, node, PULL_REQUEST_MERGED, ctx);
  if (!pr || !pr.merged || !pr.mergedAt) return [];
  return toEvidence(
    {
      repositoryId: pr.repository.databaseId,
      defaultBranch: pr.repository.defaultBranchRef.name,
      number: pr.number,
      title: pr.title,
      url: pr.url,
      baseRef: pr.baseRefName,
      headSha: pr.headRefOid,
      mergeCommitSha: pr.mergeCommit?.oid ?? null,
      mergedAt: pr.mergedAt,
      author: loginOf(pr.author),
      mergedBy: loginOf(pr.mergedBy),
      changedFiles: pr.changedFiles,
      labels: pr.labels.nodes.map((l) => l.name),
      draft: pr.isDraft,
    },
    ctx,
  );
}
