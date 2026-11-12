// Règles communes des normaliseurs GitHub (§4.5.3) : fonctions pures, entrée validée par Zod, liste blanche de champs.
// Une charge invalide donne [] et un avertissement qui ne contient jamais la charge (règle 8 de CLAUDE.md).
import { z } from "zod";
import type { CaptureMethod } from "@/generated/prisma/enums";
import type { EvidenceInput } from "@/server/services/evidence";

export interface NormalizerContext {
  orgId: string;
  /** Dépôt (IntegrationResource) auquel la preuve est rattachée. */
  resourceId: string | null;
  capturedVia: CaptureMethod;
  /** Avertissement sans charge : type de preuve et motif seulement. */
  warn?: (message: string) => void;
}

export type GitHubEvidence = Omit<EvidenceInput, "raw">;

export const repositorySchema = z.object({
  id: z.number().int().positive(),
  full_name: z.string().min(1),
  default_branch: z.string().min(1),
});

export const loginOf = (user: { login: string } | null | undefined) => user?.login ?? null;

/** Valide `payload` ; en cas d'échec, avertit sans la charge et renvoie null. */
export function parse<T>(
  schema: z.ZodType<T>,
  payload: unknown,
  kind: string,
  ctx: NormalizerContext,
): T | null {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;
  const where = result.error.issues[0]?.path.join(".") || "racine";
  (ctx.warn ?? console.warn)(`normaliseur ${kind} : charge invalide (${where})`);
  return null;
}

/** Jour UTC (AAAA-MM-JJ) : un instantané par jour et par état. */
export const dayOf = (iso: string) => iso.slice(0, 10);
