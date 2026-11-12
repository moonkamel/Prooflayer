// Normaliseur `github.file.snapshot` : présence et empreinte d'un fichier suivi (`docs/ai/**`, `CODEOWNERS`, gabarit
// de PR), d'après l'API REST des contenus. Aucun contenu de fichier n'est conservé (§4.5.1) : seuls le chemin,
// l'empreinte Git (sha du blob) et la taille. Sert à AIA-10-01, AIA-11-02, AIA-13-01, AIA-17-02.
import { z } from "zod";
import {
  dayOf,
  parse,
  repositorySchema,
  type GitHubEvidence,
  type NormalizerContext,
} from "./common";

export const FILE_SNAPSHOT = "github.file.snapshot";

const schema = z.object({
  repository: repositorySchema,
  ref: z.string().min(1),
  path: z.string().min(1),
  takenAt: z.string().datetime(),
  file: z
    .object({
      type: z.literal("file"),
      sha: z.string().min(1),
      size: z.number().int().nonnegative(),
      html_url: z.string().url().nullable().optional(),
    })
    .nullable(),
});

export function normalizeFileSnapshot(payload: unknown, ctx: NormalizerContext): GitHubEvidence[] {
  const snapshot = parse(schema, payload, FILE_SNAPSHOT, ctx);
  if (!snapshot) return [];
  const { repository: repo, file } = snapshot;
  return [
    {
      kind: FILE_SNAPSHOT,
      source: "GITHUB",
      capturedVia: ctx.capturedVia,
      resourceId: ctx.resourceId,
      sourceRef: `${repo.id}/file/${snapshot.ref}/${snapshot.path}`,
      sourceUrl: file?.html_url ?? `https://github.com/${repo.full_name}/tree/${snapshot.ref}`,
      dedupeKey: `gh:file:${repo.id}:${snapshot.ref}:${snapshot.path}:${file?.sha ?? "absent"}:${dayOf(snapshot.takenAt)}`,
      occurredAt: new Date(snapshot.takenAt),
      summary: file ? `${snapshot.path} présent` : `${snapshot.path} absent`,
      actor: null,
      payload: {
        path: snapshot.path,
        ref: snapshot.ref,
        present: file !== null,
        blobSha: file?.sha ?? null,
        size: file?.size ?? null,
        takenAt: new Date(snapshot.takenAt).toISOString(),
      },
    },
  ];
}
