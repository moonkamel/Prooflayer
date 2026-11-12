// Normaliseur `github.release.published` : webhook `release` (action « published »). Sert à AIA-09-04, AIA-11-02,
// AIA-15-04. Liste blanche : ni notes de version ni pièces jointes.
import { z } from "zod";
import {
  loginOf,
  parse,
  repositorySchema,
  type GitHubEvidence,
  type NormalizerContext,
} from "./common";

export const RELEASE_PUBLISHED = "github.release.published";

const schema = z.object({
  action: z.literal("published"),
  release: z.object({
    id: z.number().int().positive(),
    tag_name: z.string(),
    name: z.string().nullable(),
    target_commitish: z.string(),
    draft: z.boolean(),
    prerelease: z.boolean(),
    published_at: z.string().datetime().nullable(),
    html_url: z.string().url(),
    author: z.object({ login: z.string() }).nullable(),
  }),
  repository: repositorySchema,
});

export function normalizeReleasePublished(
  payload: unknown,
  ctx: NormalizerContext,
): GitHubEvidence[] {
  const event = parse(schema, payload, RELEASE_PUBLISHED, ctx);
  const publishedAt = event?.release.published_at;
  if (!event || event.release.draft || !publishedAt) return [];
  const { release, repository } = event;
  const author = loginOf(release.author);
  return [
    {
      kind: RELEASE_PUBLISHED,
      source: "GITHUB",
      capturedVia: ctx.capturedVia,
      resourceId: ctx.resourceId,
      sourceRef: `${repository.id}/release/${release.id}`,
      sourceUrl: release.html_url,
      dedupeKey: `gh:release:${repository.id}:${release.id}`,
      occurredAt: new Date(publishedAt),
      summary: `Release ${release.tag_name} publiée`,
      actor: author ? { login: author } : null,
      payload: {
        releaseId: release.id,
        tagName: release.tag_name,
        name: release.name,
        targetCommitish: release.target_commitish,
        prerelease: release.prerelease,
        publishedAt: new Date(publishedAt).toISOString(),
        author,
      },
    },
  ];
}
